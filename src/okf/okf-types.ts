import type { SourceDocument } from "../retrieval/source-document.js";
import type { OkfDocument } from "./okf-schema.js";

export interface GovernanceIssue {
  code: string;
  file: string;
  field: string;
  message: string;
}

export type ValidatedOkfDocument = OkfDocument;

export function toSourceDocument(
  document: ValidatedOkfDocument,
): SourceDocument {
  return {
    knowledgeId: document.knowledgeId,
    title: document.title,
    artifactType: document.artifactType,
    sourceSystem: "okf",
    sourceUri: document.sourceUri,
    sourceRevision: document.sourceRevision,
    product: document.product,
    domain: document.domain,
    classification: document.classification,
    status: document.status,
    content: document.content,
    locator: document.locator ?? {},
    ...(document.verifiedAt === undefined
      ? {}
      : { verifiedAt: document.verifiedAt }),
    ...(document.staleAfter === undefined
      ? {}
      : { staleAfter: document.staleAfter }),
    ...(document.relations.supersededBy === undefined
      ? {}
      : { successorKnowledgeId: document.relations.supersededBy }),
    acl: document.acl,
  };
}
