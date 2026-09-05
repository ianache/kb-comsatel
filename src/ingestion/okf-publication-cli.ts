import { compileOkfCorpus } from "../okf/compiler.js";
import { loadConfig } from "../config.js";
import { createRuntimePublicationPort } from "../publication/gitlab-http-adapter.js";
import { PublicationError } from "../publication/publication-errors.js";
import { PublicationService } from "../publication/publication-service.js";
import { buildPublicationPlan } from "../publication/publication-plan.js";
import type {
  PublicationMode,
  PublicationRequest,
} from "../publication/publication-types.js";

export interface PublicationArgs {
  command: "plan" | "publish";
  sourceDir: string;
  mode: PublicationMode;
}

export function parsePublicationArgs(args: readonly string[]): PublicationArgs {
  const command = args[0];
  if (command !== "plan" && command !== "publish") {
    throw new Error("Publication command must be plan or publish");
  }
  const positional = args
    .slice(1)
    .filter((argument) => !argument.startsWith("-"));
  const sourceDir = positional[0];
  const mode = positional[1] ?? "proposal";
  if (sourceDir === undefined)
    throw new Error("OKF source directory is required");
  if (mode !== "proposal" && mode !== "approved-publish") {
    throw new Error("Publication mode must be proposal or approved-publish");
  }
  return { command, sourceDir, mode };
}

export async function runPublicationCommand(
  environment: Record<string, string | undefined>,
  args: readonly string[],
): Promise<number> {
  try {
    const options = parsePublicationArgs(args);
    const corpus = await compileOkfCorpus(options.sourceDir, {
      mode: "stable",
    });
    if (corpus.errors.length > 0) {
      console.error(JSON.stringify({ errors: corpus.errors }));
      return 1;
    }
    const config = loadConfig(environment);
    const planRequest = makeRequest(
      environment,
      config,
      corpus,
      options.mode,
      "plan-only",
    );
    if (options.command === "plan") {
      const plan = buildPublicationPlan(planRequest);
      console.log(
        JSON.stringify({
          branchName: plan.branchName,
          corpusHash: plan.corpusHash,
          files: plan.files.map((file) => file.path),
          mode: plan.mode,
        }),
      );
      return 0;
    }

    const gitlab = createRuntimePublicationPort(config);
    if (gitlab === undefined || config.gitlabProjectId === undefined) {
      throw new PublicationError(
        "GITLAB_AUTH_REQUIRED",
        "GitLab publication is disabled",
      );
    }
    const baseBranch = await gitlab.getBranch(
      config.gitlabProjectId,
      config.gitlabBaseBranch,
    );
    if (baseBranch === null) {
      throw new PublicationError(
        "GITLAB_PROJECT_NOT_ALLOWED",
        "Base branch is unavailable",
      );
    }
    const request = makeRequest(
      environment,
      config,
      corpus,
      options.mode,
      baseBranch.sha,
    );
    const service = new PublicationService(gitlab);
    const result =
      options.mode === "approved-publish"
        ? await service.publishApproved(request)
        : await service.createProposal(request);
    console.log(JSON.stringify(result));
    return 0;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Publication failed";
    console.error(JSON.stringify({ error: message }));
    return 2;
  }
}

function makeRequest(
  environment: Record<string, string | undefined>,
  config: ReturnType<typeof loadConfig>,
  corpus: Awaited<ReturnType<typeof compileOkfCorpus>>,
  mode: PublicationMode,
  baseSha: string,
): PublicationRequest {
  return {
    projectId:
      config.gitlabProjectId ??
      environment.KCP_GITLAB_PROJECT_ID ??
      "local-plan",
    baseBranch: config.gitlabBaseBranch,
    baseSha,
    branchPrefix: config.gitlabBranchPrefix,
    corpus,
    title: environment.KCP_GITLAB_TITLE ?? "Publish OKF corpus",
    description:
      environment.KCP_GITLAB_DESCRIPTION ?? "Curated OKF publication",
    labels: (environment.KCP_GITLAB_LABELS ?? "knowledge,okf")
      .split(",")
      .map((label) => label.trim())
      .filter(Boolean),
    reviewerIds: (environment.KCP_GITLAB_REVIEWER_IDS ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
    mode,
    correlationId: environment.KCP_CORRELATION_ID ?? "okf-publication",
  };
}

if (process.argv[1]?.endsWith("okf-publication-cli.ts")) {
  process.exitCode = await runPublicationCommand(
    process.env as Record<string, string | undefined>,
    process.argv.slice(2),
  );
}
