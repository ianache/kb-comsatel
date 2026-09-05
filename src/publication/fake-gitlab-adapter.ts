import { PublicationError } from "./publication-errors.js";
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

export class FakeGitLabAdapter implements GitLabPort {
  private readonly branches = new Map<string, GitLabBranch>();
  private readonly mergeRequests = new Map<
    number,
    GitLabMergeRequest & { identityKey?: string; gate: MergeRequestGate }
  >();
  private readonly commits = new Map<string, GitLabCommit>();
  private nextMrIid = 1;
  private nextCommitId = 1;
  readonly calls: string[] = [];

  constructor(
    private readonly allowedProjects: readonly string[] = ["project-1"],
  ) {
    this.branches.set(this.branchKey("project-1", "main"), {
      name: "main",
      sha: "base-sha-1",
    });
  }

  async getBranch(
    projectId: string,
    branch: string,
  ): Promise<GitLabBranch | null> {
    this.assertProject(projectId);
    this.calls.push(`getBranch:${projectId}:${branch}`);
    return this.branches.get(this.branchKey(projectId, branch)) ?? null;
  }

  async findOpenMergeRequest(
    input: MergeRequestIdentity,
  ): Promise<GitLabMergeRequest | null> {
    this.assertProject(input.projectId);
    this.calls.push(`findMr:${input.identityKey}`);
    for (const mergeRequest of this.mergeRequests.values()) {
      if (
        mergeRequest.state === "opened" &&
        mergeRequest.identityKey === input.identityKey
      ) {
        return mergeRequest;
      }
    }
    return null;
  }

  async createBranch(input: CreateBranchInput): Promise<GitLabBranch> {
    this.assertProject(input.projectId);
    this.calls.push(`createBranch:${input.branch}`);
    const branch = { name: input.branch, sha: input.ref };
    this.branches.set(this.branchKey(input.projectId, input.branch), branch);
    return branch;
  }

  async createCommit(input: CreateCommitInput): Promise<GitLabCommit> {
    this.assertProject(input.projectId);
    this.calls.push(`createCommit:${input.branch}`);
    const id = `commit-${this.nextCommitId++}`;
    const commit = { id, webUrl: `https://gitlab.example.test/${id}` };
    this.commits.set(id, commit);
    const branchKey = this.branchKey(input.projectId, input.branch);
    this.branches.set(branchKey, { name: input.branch, sha: id });
    return commit;
  }

  async createMergeRequest(
    input: CreateMergeRequestInput,
  ): Promise<GitLabMergeRequest> {
    this.assertProject(input.projectId);
    this.calls.push(`createMr:${input.sourceBranch}`);
    const iid = this.nextMrIid++;
    const marker = input.description.match(
      /<!-- kcp-publication: ([^ ]+) -->/u,
    )?.[1];
    const mergeRequest = {
      iid,
      webUrl: `https://gitlab.example.test/${input.projectId}/-/merge_requests/${iid}`,
      sourceBranch: input.sourceBranch,
      targetBranch: input.targetBranch,
      state: "opened" as const,
      description: input.description,
      identityKey: marker,
      gate: { approved: false, ci: "success" as const },
    };
    this.mergeRequests.set(iid, mergeRequest);
    return mergeRequest;
  }

  async getMergeRequestGate(input: MergeRequestRef): Promise<MergeRequestGate> {
    this.assertProject(input.projectId);
    this.calls.push(`getGate:${input.iid}`);
    const mergeRequest = this.mergeRequests.get(input.iid);
    if (mergeRequest === undefined) {
      throw new PublicationError(
        "GITLAB_UNAVAILABLE",
        "Merge Request not found",
      );
    }
    return mergeRequest.gate;
  }

  setBranchSha(projectId: string, branch: string, sha: string): void {
    const current = this.branches.get(this.branchKey(projectId, branch));
    this.branches.set(this.branchKey(projectId, branch), {
      name: branch,
      sha: current?.sha === undefined ? sha : sha,
    });
  }

  seedBranch(projectId: string, branch: string, sha: string): void {
    this.branches.set(this.branchKey(projectId, branch), { name: branch, sha });
  }

  setGate(iid: number, gate: MergeRequestGate): void {
    const mergeRequest = this.mergeRequests.get(iid);
    if (mergeRequest !== undefined) mergeRequest.gate = gate;
  }

  private assertProject(projectId: string): void {
    if (!this.allowedProjects.includes(projectId)) {
      throw new PublicationError(
        "GITLAB_PROJECT_NOT_ALLOWED",
        "GitLab project is not allowed",
      );
    }
  }

  private branchKey(projectId: string, branch: string): string {
    return `${projectId}:${branch}`;
  }
}
