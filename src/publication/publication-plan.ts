import { PublicationError } from "./publication-errors.js";
import type {
  PublicationPlan,
  PublicationRequest,
} from "./publication-types.js";

export function buildPublicationPlan(
  request: PublicationRequest,
): PublicationPlan {
  if (request.corpus.errors.length > 0) {
    throw new PublicationError(
      "PUBLICATION_INVALID_CORPUS",
      "Cannot publish an invalid OKF corpus",
    );
  }
  const corpusHash = request.corpus.manifest.corpusHash;
  const identityKey = [
    request.projectId,
    request.baseBranch,
    corpusHash,
    request.mode,
  ].join("|");
  const branchName = `${safeBranchPrefix(request.branchPrefix)}/${corpusHash}`;
  const files = request.corpus.okfDocuments
    .filter((document) => document.status === "stable")
    .sort((left, right) => left.knowledgeId.localeCompare(right.knowledgeId))
    .map((document) => ({
      path: `knowledge/${encodeURIComponent(document.knowledgeId)}.md`,
      content: document.content,
    }));
  const marker = `<!-- kcp-publication: ${identityKey} -->`;
  return {
    identityKey,
    branchName,
    commitMessage: `knowledge: propose corpus ${corpusHash}`,
    mergeRequestTitle: request.title,
    mergeRequestDescription: `${request.description}\n\n${marker}`,
    files,
    mode: request.mode,
    corpusHash,
  };
}

function safeBranchPrefix(prefix: string): string {
  const normalized = prefix.trim().replace(/[^a-zA-Z0-9/_-]/gu, "-");
  return normalized.replace(/^\/+|\/+$/gu, "") || "knowledge/proposal";
}
