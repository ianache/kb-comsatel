import { randomUUID } from "node:crypto";
import { KcpError } from "../domain/errors.js";
import type { SqlExecutor } from "./sql-executor.js";
import type {
  CatalogWriter,
  IndexRunInput,
} from "../retrieval/catalog-writer.js";
import type {
  DocumentChunk,
  SourceDocument,
} from "../retrieval/source-document.js";

export class MySqlCatalogWriter implements CatalogWriter {
  constructor(private readonly executor: SqlExecutor) {}

  async getRevisionState(
    knowledgeId: string,
    sourceRevision: string,
  ): Promise<{ contentHash: string; indexed: boolean } | null> {
    try {
      const rows = await this.executor.query<{
        content_hash: string;
        indexed: number;
      }>(
        `SELECT r.content_hash,
                EXISTS (
                  SELECT 1 FROM knowledge_index_runs i
                  WHERE i.knowledge_id = r.knowledge_id
                    AND i.source_revision = r.source_revision
                    AND i.status = 'completed'
                ) AS indexed
         FROM knowledge_revisions r
         WHERE r.knowledge_id = ? AND r.source_revision = ?
         LIMIT 1`,
        [knowledgeId, sourceRevision],
      );
      const row = rows[0];
      return row === undefined
        ? null
        : {
            contentHash: String(row.content_hash),
            indexed: Boolean(row.indexed),
          };
    } catch {
      throw new KcpError("INTERNAL_ERROR", "Knowledge index unavailable");
    }
  }

  async beginIndexRun(input: IndexRunInput): Promise<string> {
    const runId = randomUUID();
    try {
      await this.executor.execute(
        `INSERT INTO knowledge_index_runs
          (run_id, knowledge_id, source_revision, status, embedding_model,
           vector_dimension, started_at)
         VALUES (?, ?, ?, 'running', ?, ?, UTC_TIMESTAMP(3))`,
        [
          runId,
          input.knowledgeId,
          input.sourceRevision,
          input.model,
          input.dimension,
        ],
      );
      return runId;
    } catch {
      throw new KcpError("INTERNAL_ERROR", "Knowledge index unavailable");
    }
  }

  async upsertDocument(
    document: SourceDocument,
    contentHash: string,
  ): Promise<void> {
    try {
      await this.executor.execute(
        `INSERT INTO knowledge_artifacts
          (knowledge_id, title, artifact_type, product, domain, classification,
           current_status, source_system, created_at, updated_at)
         VALUES (?, ?, 'document', ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
         ON DUPLICATE KEY UPDATE
           title = VALUES(title), product = VALUES(product), domain = VALUES(domain),
           classification = VALUES(classification), current_status = VALUES(current_status),
           source_system = VALUES(source_system), updated_at = UTC_TIMESTAMP(3)`,
        [
          document.knowledgeId,
          document.title,
          document.product,
          document.domain,
          document.classification,
          document.status,
          document.sourceSystem,
        ],
      );
      await this.executor.execute(
        `INSERT INTO knowledge_revisions
          (knowledge_id, source_revision, source_uri, content_hash, section_path,
           page_range, line_range, verified_at, stale_after)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           source_uri = VALUES(source_uri), content_hash = VALUES(content_hash),
           section_path = VALUES(section_path), page_range = VALUES(page_range),
           line_range = VALUES(line_range), verified_at = VALUES(verified_at),
           stale_after = VALUES(stale_after)`,
        [
          document.knowledgeId,
          document.sourceRevision,
          document.sourceUri,
          contentHash,
          document.locator.sectionPath ?? null,
          document.locator.pageRange ?? null,
          document.locator.lineRange ?? null,
          document.verifiedAt ?? null,
          document.staleAfter ?? null,
        ],
      );
      await this.executor.execute(
        `INSERT INTO knowledge_excerpts (knowledge_id, source_revision, excerpt)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE excerpt = VALUES(excerpt)`,
        [
          document.knowledgeId,
          document.sourceRevision,
          document.content.slice(0, 2000),
        ],
      );
    } catch {
      throw new KcpError("INTERNAL_ERROR", "Knowledge catalog unavailable");
    }
  }

  async replaceChunks(
    knowledgeId: string,
    sourceRevision: string,
    chunks: readonly DocumentChunk[],
  ): Promise<void> {
    try {
      await this.executor.execute(
        "DELETE FROM knowledge_chunks WHERE knowledge_id = ? AND source_revision = ?",
        [knowledgeId, sourceRevision],
      );
      for (const chunk of chunks) {
        await this.executor.execute(
          `INSERT INTO knowledge_chunks
            (chunk_id, knowledge_id, source_revision, ordinal, chunk_text,
             content_hash, character_count, token_estimate, section_path,
             page_range, line_range, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
          [
            chunk.chunkId,
            chunk.knowledgeId,
            chunk.sourceRevision,
            chunk.ordinal,
            chunk.text,
            chunk.contentHash,
            chunk.characterCount,
            chunk.tokenEstimate,
            chunk.locator.sectionPath ?? null,
            chunk.locator.pageRange ?? null,
            chunk.locator.lineRange ?? null,
          ],
        );
      }
    } catch {
      throw new KcpError("INTERNAL_ERROR", "Knowledge catalog unavailable");
    }
  }

  async completeIndexRun(
    runId: string,
    counts: { chunks: number; vectors: number },
  ): Promise<void> {
    await this.updateRun(runId, "completed", counts, null);
  }

  async failIndexRun(runId: string, failureCode: string): Promise<void> {
    await this.updateRun(
      runId,
      "failed",
      { chunks: 0, vectors: 0 },
      failureCode,
    );
  }

  private async updateRun(
    runId: string,
    status: "completed" | "failed",
    counts: { chunks: number; vectors: number },
    failureCode: string | null,
  ): Promise<void> {
    try {
      await this.executor.execute(
        `UPDATE knowledge_index_runs
         SET status = ?, chunk_count = ?, vector_count = ?, failure_code = ?,
             completed_at = UTC_TIMESTAMP(3)
         WHERE run_id = ?`,
        [status, counts.chunks, counts.vectors, failureCode, runId],
      );
    } catch {
      throw new KcpError("INTERNAL_ERROR", "Knowledge index unavailable");
    }
  }
}
