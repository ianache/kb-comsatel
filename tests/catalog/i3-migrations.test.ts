import { expect, it } from "vitest";
import { migrationSql } from "../../src/catalog/migrations.js";

it("contains I3 chunk and index-state tables and indexes", () => {
  const sql = migrationSql.join("\n");
  expect(sql).toContain("CREATE TABLE IF NOT EXISTS knowledge_chunks");
  expect(sql).toContain("CREATE TABLE IF NOT EXISTS knowledge_index_runs");
  expect(sql).toContain("FOREIGN KEY (knowledge_id, source_revision)");
  expect(sql).toContain("UNIQUE KEY uq_chunk_revision_ordinal");
  expect(sql).toContain("FULLTEXT INDEX idx_chunk_text");
  expect(sql).toContain("'stale'");
  expect(sql).toContain("successor_knowledge_id");
});
