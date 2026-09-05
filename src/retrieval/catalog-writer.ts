import type { DocumentChunk, SourceDocument } from "./source-document.js";

export type IndexRunStatus = "running" | "completed" | "failed";

export interface IndexRunInput {
  knowledgeId: string;
  sourceRevision: string;
  model: string;
  dimension: number;
}

export interface CatalogWriter {
  beginIndexRun(input: IndexRunInput): Promise<string>;
  upsertDocument(document: SourceDocument, contentHash: string): Promise<void>;
  replaceChunks(
    knowledgeId: string,
    sourceRevision: string,
    chunks: readonly DocumentChunk[],
  ): Promise<void>;
  completeIndexRun(
    runId: string,
    counts: { chunks: number; vectors: number },
  ): Promise<void>;
  failIndexRun(runId: string, failureCode: string): Promise<void>;
}
