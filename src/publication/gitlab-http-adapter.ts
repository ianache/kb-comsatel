import { z } from "zod";
import type { AppConfig } from "../config.js";
import { PublicationError } from "./publication-errors.js";
import {
  gitlabBranchSchema,
  gitlabCommitSchema,
  gitlabMergeRequestSchema,
} from "./gitlab-schemas.js";
import type {
  CreateBranchInput,
  CreateCommitInput,
  CreateMergeRequestInput,
  GitLabBranch,
  GitLabCommit,
  GitLabMergeRequest,
  GitLabPort,
  MergeRequestGate,
  MergeRequestIdentity,
  MergeRequestRef,
} from "./gitlab-port.js";
import type { CircuitBreaker, OperationDeadline } from "../ops/resilience.js";
import { createOperationDeadline } from "../ops/resilience.js";
import type { EgressPolicy } from "../security/egress-policy.js";
import { createEgressPolicy } from "../security/egress-policy.js";
import { createCircuitBreaker } from "../ops/resilience.js";

export type GitLabPublicationConfig = Pick<
  AppConfig,
  | "gitlabPublicationEnabled"
  | "gitlabBaseUrl"
  | "gitlabProjectId"
  | "gitlabToken"
  | "gitlabTimeoutMs"
  | "egressAllowHttp"
  | "egressAllowPrivateNetworks"
  | "egressGitlabAllowedHosts"
  | "egressGitlabSourceAllowedHosts"
  | "egressDriveAllowedHosts"
  | "egressEmbeddingAllowedHosts"
  | "egressQdrantAllowedHosts"
  | "egressOidcAllowedHosts"
  | "breakerFailureThreshold"
  | "breakerOpenMs"
  | "breakerHalfOpenMaxCalls"
>;

export type Fetcher = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface GitLabHttpAdapterOptions {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
  fetcher?: Fetcher;
  egressPolicy?: EgressPolicy;
  breaker?: CircuitBreaker;
  deadline?: OperationDeadline;
}

export class GitLabHttpAdapter implements GitLabPort {
  private readonly fetcher: Fetcher;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: GitLabHttpAdapterOptions) {
    if (options.token.trim().length === 0) {
      throw new PublicationError(
        "GITLAB_AUTH_REQUIRED",
        "GitLab token is required",
      );
    }
    this.fetcher = options.fetcher ?? globalThis.fetch;
    this.baseUrl = `${options.baseUrl.replace(/\/$/u, "")}/api/v4`;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async getBranch(
    projectId: string,
    branch: string,
  ): Promise<GitLabBranch | null> {
    const body = await this.request(
      this.projectUrl(
        projectId,
        `/repository/branches/${encodeURIComponent(branch)}`,
      ),
      { method: "GET" },
      true,
    );
    if (body === null) return null;
    const parsed = gitlabBranchSchema.safeParse(body);
    if (!parsed.success)
      throw unavailable(undefined, "invalid branch response");
    return { name: parsed.data.name, sha: parsed.data.commit.id };
  }

  async findOpenMergeRequest(
    input: MergeRequestIdentity,
  ): Promise<GitLabMergeRequest | null> {
    const query = new URLSearchParams({
      state: "opened",
      source_branch: input.sourceBranch,
      target_branch: input.targetBranch,
      per_page: "100",
    });
    const body = await this.request(
      this.projectUrl(input.projectId, `/merge_requests?${query.toString()}`),
      { method: "GET" },
    );
    const parsed = z.array(gitlabMergeRequestSchema).safeParse(body);
    if (!parsed.success)
      throw unavailable(undefined, "invalid merge request response");
    const match = parsed.data.find((item) =>
      item.description.includes(
        `<!-- kcp-publication: ${input.identityKey} -->`,
      ),
    );
    return match === undefined ? null : mapMergeRequest(match);
  }

  async createBranch(input: CreateBranchInput): Promise<GitLabBranch> {
    const query = new URLSearchParams({ branch: input.branch, ref: input.ref });
    const body = await this.request(
      this.projectUrl(
        input.projectId,
        `/repository/branches?${query.toString()}`,
      ),
      { method: "POST" },
    );
    const parsed = gitlabBranchSchema.safeParse(body);
    if (!parsed.success)
      throw unavailable(undefined, "invalid branch response");
    return { name: parsed.data.name, sha: parsed.data.commit.id };
  }

  async createCommit(input: CreateCommitInput): Promise<GitLabCommit> {
    const body = await this.request(
      this.projectUrl(input.projectId, "/repository/commits"),
      {
        method: "POST",
        body: JSON.stringify({
          branch: input.branch,
          commit_message: input.commitMessage,
          actions: input.files.map((file) => ({
            action: "create",
            file_path: file.path,
            content: file.content,
          })),
        }),
      },
    );
    const parsed = gitlabCommitSchema.safeParse(body);
    if (!parsed.success)
      throw unavailable(undefined, "invalid commit response");
    return { id: parsed.data.id, webUrl: parsed.data.web_url };
  }

  async createMergeRequest(
    input: CreateMergeRequestInput,
  ): Promise<GitLabMergeRequest> {
    const body = await this.request(
      this.projectUrl(input.projectId, "/merge_requests"),
      {
        method: "POST",
        body: JSON.stringify({
          source_branch: input.sourceBranch,
          target_branch: input.targetBranch,
          title: input.title,
          description: input.description,
          labels: input.labels.join(","),
          reviewer_ids: input.reviewerIds,
        }),
      },
    );
    const parsed = gitlabMergeRequestSchema.safeParse(body);
    if (!parsed.success)
      throw unavailable(undefined, "invalid merge request response");
    return mapMergeRequest(parsed.data);
  }

  async getMergeRequestGate(input: MergeRequestRef): Promise<MergeRequestGate> {
    const approvals = await this.request(
      this.projectUrl(
        input.projectId,
        `/merge_requests/${input.iid}/approvals`,
      ),
      { method: "GET" },
    );
    const approved = approvalStateSchema.safeParse(approvals);
    if (!approved.success)
      throw unavailable(undefined, "invalid approvals response");
    const pipelines = await this.request(
      this.projectUrl(
        input.projectId,
        `/merge_requests/${input.iid}/pipelines?per_page=1`,
      ),
      { method: "GET" },
    );
    const parsedPipelines = z
      .array(z.object({ status: z.string() }).strict())
      .safeParse(pipelines);
    if (!parsedPipelines.success)
      throw unavailable(undefined, "invalid pipelines response");
    const status = parsedPipelines.data[0]?.status;
    const ci =
      status === "success" || status === "failed" || status === "running"
        ? status
        : "unknown";
    return {
      approved: approved.data.approved || approved.data.approved_by.length > 0,
      ci,
    };
  }

  private async request(
    url: string,
    init: RequestInit,
    allowNotFound = false,
  ): Promise<unknown | null> {
    const requestUrl = this.options.egressPolicy
      ? await this.options.egressPolicy.validate(url, "gitlab")
      : url;
    const deadline = this.options.deadline?.child() ??
      createOperationDeadline(this.timeoutMs);
    try {
      const request = () =>
        this.fetcher(requestUrl, {
          ...init,
          signal: deadline.signal(),
          headers: {
            ...(init.body === undefined
              ? {}
              : { "content-type": "application/json" }),
            "PRIVATE-TOKEN": this.options.token,
          },
        });
      const response = await (this.options.breaker
        ? this.options.breaker.execute(request)
        : request());
      if (allowNotFound && response.status === 404) return null;
      if (!response.ok) throw httpError(response.status);
      return (await response.json()) as unknown;
    } catch (error) {
      if (error instanceof PublicationError) throw error;
      if (error instanceof SyntaxError) {
        throw unavailable(undefined, "invalid JSON response");
      }
      if (
        (error instanceof DOMException && error.name === "AbortError") ||
        deadline.signal().aborted
      ) {
        throw unavailable(undefined, "request timed out");
      }
      throw unavailable(
        undefined,
        error instanceof Error
          ? `transport error (${error.name})`
          : "transport error",
      );
    } finally {
      deadline.dispose();
    }
  }

  private projectUrl(projectId: string, suffix: string): string {
    return `${this.baseUrl}/projects/${encodeURIComponent(projectId)}${suffix}`;
  }
}

export function createRuntimePublicationPort(
  config: GitLabPublicationConfig,
): GitLabPort | undefined {
  if (!config.gitlabPublicationEnabled) return undefined;
  if (!config.gitlabProjectId || !config.gitlabToken) {
    throw new PublicationError(
      "GITLAB_AUTH_REQUIRED",
      "GitLab publication requires project ID and token",
    );
  }
  return new GitLabHttpAdapter({
    baseUrl: config.gitlabBaseUrl,
    token: config.gitlabToken,
    timeoutMs: config.gitlabTimeoutMs,
    egressPolicy: createEgressPolicy({
      allowHttp: config.egressAllowHttp,
      allowPrivateNetworks: config.egressAllowPrivateNetworks,
      allowedHosts: {
        gitlab: config.egressGitlabAllowedHosts,
        "gitlab-source": config.egressGitlabSourceAllowedHosts,
        drive: config.egressDriveAllowedHosts,
        embedding: config.egressEmbeddingAllowedHosts,
        qdrant: config.egressQdrantAllowedHosts,
        oidc: config.egressOidcAllowedHosts,
      },
    }),
    breaker: createCircuitBreaker({
      failureThreshold: config.breakerFailureThreshold,
      openMs: config.breakerOpenMs,
      halfOpenMaxCalls: config.breakerHalfOpenMaxCalls,
    }),
  });
}

const approvalStateSchema = z
  .object({
    approved: z.boolean().default(false),
    approved_by: z.array(z.unknown()).default([]),
  })
  .passthrough();

function mapMergeRequest(
  value: z.infer<typeof gitlabMergeRequestSchema>,
): GitLabMergeRequest {
  return {
    iid: value.iid,
    webUrl: value.web_url,
    sourceBranch: value.source_branch,
    targetBranch: value.target_branch,
    state: value.state,
    description: value.description,
  };
}

function httpError(status: number): PublicationError {
  if (status === 401)
    return new PublicationError(
      "GITLAB_AUTH_REQUIRED",
      "GitLab authentication failed",
    );
  if (status === 403)
    return new PublicationError("GITLAB_FORBIDDEN", "GitLab access forbidden");
  return unavailable(status);
}

function unavailable(status?: number, reason?: string): PublicationError {
  return new PublicationError(
    "GITLAB_UNAVAILABLE",
    status === undefined
      ? reason === undefined
        ? "GitLab is unavailable"
        : `GitLab unavailable: ${reason}`
      : `GitLab request failed (HTTP ${status})`,
  );
}
