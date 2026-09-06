import { compileOkfCorpus, type CompileOptions } from "../okf/compiler.js";
import { writeProjection } from "../okf/projection-writer.js";
import { runI3Indexing, runI3IndexingSummary } from "./i3-cli.js";
import { loadConfig } from "../config.js";
import { GitLabHttpSourceAdapter } from "./gitlab-http-source-adapter.js";
import { SourceConfigurationError } from "./source-errors.js";
import { indexRemoteCorpus } from "./i5b-indexing.js";
import { createGoogleDriveOkfSource } from "./google-drive-content.js";
import { GoogleDriveHttpAdapter } from "./google-drive-http-adapter.js";

export interface OkfArgs {
  command: "validate" | "compile" | "index";
  sourceDir: string;
  outputDir: string;
  mode: CompileOptions["mode"];
  source: "local" | "gitlab" | "google-drive";
}

export function parseOkfArgs(args: readonly string[]): OkfArgs {
  const command = args[0];
  if (command !== "validate" && command !== "compile" && command !== "index") {
    throw new Error("OKF command must be validate, compile, or index");
  }
  const positional: string[] = [];
  let sourceDir: string | undefined;
  let outputDir: string | undefined;
  let mode: OkfArgs["mode"] = "stable";
  let source: OkfArgs["source"] = "local";
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined) continue;
    if (
      argument === "--source-dir" ||
      argument === "--output-dir" ||
      argument === "--mode" ||
      argument === "--source"
    ) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new Error(`Missing value for ${argument}`);
      }
      if (argument === "--source-dir") sourceDir = value;
      if (argument === "--output-dir") outputDir = value;
      if (argument === "--mode") {
        if (value !== "draft" && value !== "stable") {
          throw new Error("OKF mode must be draft or stable");
        }
        mode = value;
      }
      if (argument === "--source") {
        if (
          value !== "local" &&
          value !== "gitlab" &&
          value !== "google-drive"
        ) {
          throw new Error("OKF source must be local, gitlab, or google-drive");
        }
        source = value;
      }
      index += 1;
    } else if (!argument.startsWith("-")) {
      positional.push(argument);
    }
  }
  sourceDir ??= positional[0] ?? (source !== "local" ? "" : undefined);
  outputDir ??= positional[1] ?? ".tmp/i4a-okf-projection";
  if (sourceDir === undefined)
    throw new Error("OKF source directory is required");
  return { command, sourceDir, outputDir, mode, source };
}

export async function runOkfCommand(
  environment: Record<string, string | undefined>,
  args: readonly string[],
): Promise<number> {
  try {
    const options = parseOkfArgs(args);
    const corpusSource = await resolveCorpusSource(environment, options);
    if (
      options.command === "index" &&
      (options.source === "gitlab" || options.source === "google-drive")
    ) {
      const result = await indexRemoteCorpus(
        {
          source: corpusSource,
          outputDir: options.outputDir,
          mode: "stable",
        },
        {
          compile: compileOkfCorpus,
          write: async (corpus, outputDir) => {
            await writeProjection(corpus, outputDir);
          },
          index: (outputDir) =>
            runI3IndexingSummary({
              ...environment,
              KCP_I3_SOURCE_DIR: outputDir,
            }),
        },
      );
      console.log(JSON.stringify(result));
      return result.status === "failed" ? 1 : 0;
    }
    const corpus = await compileOkfCorpus(corpusSource, {
      mode: options.mode,
    });
    console.log(JSON.stringify(corpus.manifest.counts));
    if (corpus.errors.length > 0) {
      console.error(JSON.stringify({ errors: corpus.errors }));
      return 1;
    }
    if (options.command === "validate") return 0;

    await writeProjection(corpus, options.outputDir);
    if (options.command === "compile") return 0;

    return await runI3Indexing(
      { ...environment, KCP_I3_SOURCE_DIR: options.outputDir },
      ["--source-dir", options.outputDir],
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "OKF command failed";
    console.error(JSON.stringify({ error: message }));
    return 2;
  }
}

async function resolveCorpusSource(
  environment: Record<string, string | undefined>,
  options: OkfArgs,
): Promise<string | Parameters<typeof compileOkfCorpus>[0]> {
  if (options.source === "local") return options.sourceDir;
  const config = loadConfig(environment);
  if (options.source === "gitlab") {
    if (!config.gitlabSourceEnabled) {
      throw new SourceConfigurationError(
        "GitLab source is disabled; set KCP_GITLAB_SOURCE_ENABLED=true",
      );
    }
    if (!config.gitlabSourceProjectId || !config.gitlabSourceToken) {
      throw new SourceConfigurationError(
        "GitLab source configuration is incomplete",
      );
    }
    return {
      kind: "gitlab",
      source: new GitLabHttpSourceAdapter({
        baseUrl: config.gitlabSourceBaseUrl,
        token: config.gitlabSourceToken,
        timeoutMs: config.gitlabSourceTimeoutMs,
      }),
      projectId: config.gitlabSourceProjectId,
      ref: config.gitlabSourceRef,
      root: config.gitlabSourceRoot,
    };
  }
  if (!config.googleDriveSourceEnabled || !config.googleDriveToken) {
    throw new SourceConfigurationError(
      "Google Drive source is disabled or incomplete; set KCP_GOOGLE_DRIVE_SOURCE_ENABLED=true",
    );
  }
  return createGoogleDriveOkfSource(
    new GoogleDriveHttpAdapter({
      baseUrl: config.googleDriveBaseUrl,
      token: config.googleDriveToken,
      timeoutMs: config.googleDriveTimeoutMs,
    }),
    config.googleDriveFolderIds,
  );
}

if (process.argv[1]?.endsWith("okf-cli.ts")) {
  process.exitCode = await runOkfCommand(
    process.env as Record<string, string | undefined>,
    process.argv.slice(2),
  );
}
