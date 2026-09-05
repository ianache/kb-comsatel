import { compileOkfCorpus, type CompileOptions } from "../okf/compiler.js";
import { writeProjection } from "../okf/projection-writer.js";
import { runI3Indexing } from "./i3-cli.js";

export interface OkfArgs {
  command: "validate" | "compile" | "index";
  sourceDir: string;
  outputDir: string;
  mode: CompileOptions["mode"];
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
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined) continue;
    if (
      argument === "--source-dir" ||
      argument === "--output-dir" ||
      argument === "--mode"
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
      index += 1;
    } else if (!argument.startsWith("-")) {
      positional.push(argument);
    }
  }
  sourceDir ??= positional[0];
  outputDir ??= positional[1] ?? ".tmp/i4a-okf-projection";
  if (sourceDir === undefined)
    throw new Error("OKF source directory is required");
  return { command, sourceDir, outputDir, mode };
}

export async function runOkfCommand(
  environment: Record<string, string | undefined>,
  args: readonly string[],
): Promise<number> {
  try {
    const options = parseOkfArgs(args);
    const corpus = await compileOkfCorpus(options.sourceDir, {
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

if (process.argv[1]?.endsWith("okf-cli.ts")) {
  process.exitCode = await runOkfCommand(
    process.env as Record<string, string | undefined>,
    process.argv.slice(2),
  );
}
