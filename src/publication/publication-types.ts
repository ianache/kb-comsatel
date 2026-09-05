import type { CompiledCorpus } from "../okf/compiler.js";

export type PublicationMode = "proposal" | "approved-publish";

export interface PublicationRequest {
  projectId: string;
  baseBranch: string;
  baseSha: string;
  branchPrefix: string;
  corpus: CompiledCorpus;
  title: string;
  description: string;
  labels: readonly string[];
  reviewerIds: readonly string[];
  mode: PublicationMode;
  correlationId: string;
}

export interface PublicationFile {
  path: string;
  content: string;
}

export interface PublicationPlan {
  identityKey: string;
  branchName: string;
  commitMessage: string;
  mergeRequestTitle: string;
  mergeRequestDescription: string;
  files: readonly PublicationFile[];
  mode: PublicationMode;
  corpusHash: string;
}

export interface PublicationResult {
  branchName: string;
  commitSha: string;
  mergeRequestIid: number;
  mergeRequestUrl: string;
  mergeRequestState: "opened" | "merged" | "closed";
  ciState: "success" | "failed" | "running" | "unknown";
  fileCount: number;
  mode: PublicationMode;
  outcome: "proposal-created" | "stable-publish-authorized";
  corpusHash: string;
}
