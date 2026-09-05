import type { KnowledgeStatus, SourceSystem } from "../domain/i3-types.js";

export interface SourceLocator {
  sectionPath?: string;
  pageRange?: string;
  lineRange?: string;
}

export interface SourceAcl {
  principalIds: string[];
  roles: string[];
  groups: string[];
  products: string[];
  domains: string[];
  classifications: string[];
}

export interface SourceDocument {
  knowledgeId: string;
  title: string;
  artifactType?: string;
  sourceSystem: SourceSystem;
  sourceUri: string;
  sourceRevision: string;
  product: string;
  domain: string;
  classification: string;
  status: KnowledgeStatus;
  successorKnowledgeId?: string;
  content: string;
  locator: SourceLocator;
  verifiedAt?: string;
  staleAfter?: string;
  acl: SourceAcl;
}

export interface CanonicalDocument extends SourceDocument {
  contentHash: string;
}

export interface DocumentChunk {
  chunkId: string;
  knowledgeId: string;
  sourceRevision: string;
  ordinal: number;
  text: string;
  contentHash: string;
  characterCount: number;
  tokenEstimate: number;
  locator: SourceLocator;
}
