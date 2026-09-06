import { GitLabSourceError } from "./source-errors.js";
import type {
  GitLabSourcePort,
  SourceFile,
  SourceTreeEntry,
} from "./source-port.js";
import { sourceUri } from "./fake-gitlab-source-adapter.js";
import type { CircuitBreaker, OperationDeadline } from "../ops/resilience.js";
import { createOperationDeadline } from "../ops/resilience.js";
import type { EgressPolicy } from "../security/egress-policy.js";

export type SourceFetcher = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface GitLabHttpSourceAdapterOptions {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
  fetcher?: SourceFetcher;
  egressPolicy?: EgressPolicy;
  breaker?: CircuitBreaker;
  deadline?: OperationDeadline;
}

export class GitLabHttpSourceAdapter implements GitLabSourcePort {
  private readonly fetcher: SourceFetcher;
  private readonly apiBaseUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: GitLabHttpSourceAdapterOptions) {
    if (options.token.trim().length === 0)
      throw new GitLabSourceError(
        "SOURCE_AUTH_REQUIRED",
        "GitLab source token is required",
      );
    this.fetcher = options.fetcher ?? globalThis.fetch;
    this.apiBaseUrl = `${options.baseUrl.replace(/\/$/u, "")}/api/v4`;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async resolveRevision(input: {
    projectId: string;
    ref: string;
  }): Promise<string> {
    const body = await this.request(
      this.projectUrl(
        input.projectId,
        `/repository/commits/${encodeURIComponent(input.ref)}`,
      ),
    );
    if (!isRecord(body) || typeof body.id !== "string")
      throw new GitLabSourceError(
        "SOURCE_INVALID_RESPONSE",
        "GitLab source returned an invalid commit response",
      );
    return body.id;
  }

  async listTree(input: {
    projectId: string;
    ref: string;
    root?: string;
  }): Promise<readonly SourceTreeEntry[]> {
    const query = new URLSearchParams({ recursive: "true", ref: input.ref });
    if (input.root) query.set("path", input.root);
    const body = await this.request(
      this.projectUrl(input.projectId, `/repository/tree?${query}`),
    );
    if (!Array.isArray(body) || !body.every(isTreeEntry))
      throw new GitLabSourceError(
        "SOURCE_INVALID_RESPONSE",
        "GitLab source returned an invalid tree response",
      );
    return body.map((entry) => ({ path: entry.path, type: entry.type }));
  }

  async readFile(input: {
    projectId: string;
    ref: string;
    path: string;
  }): Promise<SourceFile> {
    const path = input.path.split("/").map(encodeURIComponent).join("%2F");
    const response = await this.requestResponse(
      this.projectUrl(
        input.projectId,
        `/repository/files/${path}/raw?ref=${encodeURIComponent(input.ref)}`,
      ),
    );
    return {
      relativePath: input.path,
      content: await response.text(),
      sourceRevision: await this.resolveRevision(input),
      sourceUri: sourceUri(input.projectId, input.ref, input.path),
    };
  }

  private async request(path: string): Promise<unknown> {
    const response = await this.requestResponse(path);
    try {
      return await response.json();
    } catch {
      throw new GitLabSourceError(
        "SOURCE_INVALID_RESPONSE",
        "GitLab source returned invalid JSON",
      );
    }
  }

  private async requestResponse(path: string): Promise<Response> {
    const url = this.options.egressPolicy
      ? await this.options.egressPolicy.validate(path, "gitlab-source")
      : path;
    const deadline = this.options.deadline?.child() ??
      createOperationDeadline(this.timeoutMs);
    try {
      const request = () =>
        this.fetcher(url, {
          method: "GET",
          headers: { "PRIVATE-TOKEN": this.options.token },
          signal: deadline.signal(),
        });
      const response = await (this.options.breaker
        ? this.options.breaker.execute(request)
        : request());
      if (!response.ok) {
        const code =
          response.status === 401 || response.status === 403
            ? "SOURCE_AUTH_REQUIRED"
            : response.status === 404
              ? "SOURCE_NOT_FOUND"
              : "SOURCE_UNAVAILABLE";
        throw new GitLabSourceError(
          code,
          `GitLab source request failed (HTTP ${response.status})`,
        );
      }
      return response;
    } catch (error) {
      if (error instanceof GitLabSourceError) throw error;
      throw new GitLabSourceError(
        "SOURCE_UNAVAILABLE",
        "GitLab source is unavailable",
      );
    } finally {
      // The deadline owns the abort timer and is bounded by the operation.
    }
  }

  private projectUrl(projectId: string, suffix: string): string {
    return `${this.apiBaseUrl}/projects/${encodeURIComponent(projectId)}${suffix}`;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTreeEntry(
  value: unknown,
): value is { path: string; type: "blob" | "tree" } {
  return (
    isRecord(value) &&
    typeof value.path === "string" &&
    (value.type === "blob" || value.type === "tree")
  );
}
