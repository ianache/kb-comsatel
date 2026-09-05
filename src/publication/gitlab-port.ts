export interface GitLabBranch {
  name: string;
  sha: string;
}

export interface GitLabCommit {
  id: string;
  webUrl: string;
}

export interface GitLabMergeRequest {
  iid: number;
  webUrl: string;
  sourceBranch: string;
  targetBranch: string;
  state: "opened" | "merged" | "closed";
  description: string;
}

export interface MergeRequestGate {
  approved: boolean;
  ci: "success" | "failed" | "running" | "unknown";
}

export interface MergeRequestIdentity {
  projectId: string;
  sourceBranch: string;
  targetBranch: string;
  identityKey: string;
}

export interface CreateBranchInput {
  projectId: string;
  branch: string;
  ref: string;
}

export interface CreateCommitInput {
  projectId: string;
  branch: string;
  commitMessage: string;
  files: readonly { path: string; content: string }[];
}

export interface CreateMergeRequestInput {
  projectId: string;
  sourceBranch: string;
  targetBranch: string;
  title: string;
  description: string;
  labels: readonly string[];
  reviewerIds: readonly string[];
}

export interface MergeRequestRef {
  projectId: string;
  iid: number;
}

export interface GitLabPort {
  getBranch(projectId: string, branch: string): Promise<GitLabBranch | null>;
  findOpenMergeRequest(
    input: MergeRequestIdentity,
  ): Promise<GitLabMergeRequest | null>;
  createBranch(input: CreateBranchInput): Promise<GitLabBranch>;
  createCommit(input: CreateCommitInput): Promise<GitLabCommit>;
  createMergeRequest(
    input: CreateMergeRequestInput,
  ): Promise<GitLabMergeRequest>;
  getMergeRequestGate(input: MergeRequestRef): Promise<MergeRequestGate>;
}
