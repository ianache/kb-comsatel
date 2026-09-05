import { canonicalizeDocument } from "./canonicalizer.js";
import { chunkDocument, type ChunkOptions } from "./chunker.js";
import type { DocumentSource } from "./document-source.js";
import type { EmbeddingProvider } from "./embedding-provider.js";
import type { CatalogWriter } from "./catalog-writer.js";
import type { VectorPoint, VectorStore } from "./vector-store.js";

export interface IngestionIndexerOptions {
  chunk: ChunkOptions;
  batchSize?: number;
}

export interface IngestionSummary {
  processed: number;
  skipped: number;
  chunks: number;
  vectors: number;
  failed: number;
}

export class IngestionIndexer {
  private readonly batchSize: number;

  constructor(
    private readonly source: DocumentSource,
    private readonly embeddings: EmbeddingProvider,
    private readonly vectors: VectorStore,
    private readonly catalog: CatalogWriter,
    private readonly options: IngestionIndexerOptions,
  ) {
    this.batchSize = options.batchSize ?? 16;
  }

  async ingest(): Promise<IngestionSummary> {
    const summary: IngestionSummary = {
      processed: 0,
      skipped: 0,
      chunks: 0,
      vectors: 0,
      failed: 0,
    };
    for await (const sourceDocument of this.source.list()) {
      const document = canonicalizeDocument(sourceDocument);
      const state = await this.catalog.getRevisionState(
        document.knowledgeId,
        document.sourceRevision,
      );
      if (state?.contentHash === document.contentHash && state.indexed) {
        summary.skipped += 1;
        continue;
      }

      const runId = await this.catalog.beginIndexRun({
        knowledgeId: document.knowledgeId,
        sourceRevision: document.sourceRevision,
        model: "pending",
        dimension: 0,
      });
      try {
        await this.catalog.upsertDocument(document, document.contentHash);
        const chunks = chunkDocument(document, this.options.chunk);
        const points: VectorPoint[] = [];
        for (let offset = 0; offset < chunks.length; offset += this.batchSize) {
          const batch = chunks.slice(offset, offset + this.batchSize);
          const embedded = await this.embeddings.embed(
            batch.map((chunk) => chunk.text),
          );
          if (embedded.vectors.length !== batch.length) {
            throw new Error("embedding count mismatch");
          }
          for (const [index, chunk] of batch.entries()) {
            const vector = embedded.vectors[index];
            if (vector === undefined || vector.length !== embedded.dimension) {
              throw new Error("embedding dimension mismatch");
            }
            points.push({
              id: chunk.chunkId,
              vector,
              payload: {
                chunkId: chunk.chunkId,
                knowledgeId: document.knowledgeId,
                sourceRevision: document.sourceRevision,
                product: document.product,
                domain: document.domain,
                classification: document.classification,
                status: document.status,
                sourceSystem: document.sourceSystem,
                verified: document.verifiedAt !== undefined,
                stale: document.staleAfter !== undefined,
              },
            });
          }
        }
        await this.vectors.upsert(points);
        await this.catalog.replaceChunks(
          document.knowledgeId,
          document.sourceRevision,
          chunks,
        );
        await this.catalog.completeIndexRun(runId, {
          chunks: chunks.length,
          vectors: points.length,
        });
        summary.processed += 1;
        summary.chunks += chunks.length;
        summary.vectors += points.length;
      } catch (error) {
        summary.failed += 1;
        await this.vectors
          .deleteByRevision(document.knowledgeId, document.sourceRevision)
          .catch(() => undefined);
        await this.catalog.failIndexRun(runId, failureCode(error));
        throw error;
      }
    }
    return summary;
  }
}

function failureCode(error: unknown): string {
  if (error instanceof Error && error.message.includes("dimension")) {
    return "EMBEDDING_DIMENSION_MISMATCH";
  }
  if (error instanceof Error && error.message.includes("embedding")) {
    return "EMBEDDING_UNAVAILABLE";
  }
  return "INDEXING_FAILED";
}
