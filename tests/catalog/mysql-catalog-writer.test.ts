import { describe, expect, it } from "vitest";
import { MySqlCatalogWriter } from "../../src/catalog/mysql-catalog-writer.js";
import type { SqlExecutor } from "../../src/catalog/sql-executor.js";
import type { SourceDocument } from "../../src/retrieval/source-document.js";

const document: SourceDocument = {
  knowledgeId: "doc-1",
  title: "Manual document",
  sourceSystem: "gitlab",
  sourceUri: "https://example.test/doc-1",
  sourceRevision: "rev-1",
  product: "cgo",
  domain: "units",
  classification: "internal",
  status: "stable",
  content: "secret prompt text that stays parameterized",
  locator: { sectionPath: "intro" },
  acl: {
    principalIds: [],
    roles: [],
    groups: ["reviewers"],
    products: [],
    domains: [],
    classifications: ["internal"],
  },
};

function fakeExecutor() {
  const calls: Array<{ sql: string; params: readonly unknown[] }> = [];
  const executor: SqlExecutor = {
    query: async () => [],
    execute: async (sql, params) => {
      calls.push({ sql, params });
    },
    ping: async () => undefined,
    close: async () => undefined,
  };
  return { calls, executor };
}

describe("MySqlCatalogWriter", () => {
  it("binds document metadata and chunk content as parameters", async () => {
    const { calls, executor } = fakeExecutor();
    const writer = new MySqlCatalogWriter(executor);
    const runId = await writer.beginIndexRun({
      knowledgeId: "doc-1",
      sourceRevision: "rev-1",
      model: "test",
      dimension: 3,
    });
    await writer.upsertDocument(document, "hash-1");
    await writer.replaceChunks("doc-1", "rev-1", [
      {
        chunkId: "chunk-1",
        knowledgeId: "doc-1",
        sourceRevision: "rev-1",
        ordinal: 0,
        text: document.content,
        contentHash: "hash-1",
        characterCount: document.content.length,
        tokenEstimate: 8,
        locator: { sectionPath: "intro" },
      },
    ]);
    await writer.completeIndexRun(runId, { chunks: 1, vectors: 1 });

    expect(calls.length).toBeGreaterThan(4);
    expect(calls.every((call) => call.sql.includes("?"))).toBe(true);
    expect(calls.map((call) => call.sql.toLowerCase()).join(" ")).not.toContain(
      "prompt",
    );
    expect(calls.flatMap((call) => call.params)).toContain(document.content);
  });

  it("reads revision state with parameterized metadata", async () => {
    const { executor } = fakeExecutor();
    executor.query = async () => [{ content_hash: "hash-1", indexed: 1 }];
    await expect(
      new MySqlCatalogWriter(executor).getRevisionState("doc-1", "rev-1"),
    ).resolves.toEqual({ contentHash: "hash-1", indexed: true });
  });

  it("maps database failures to a safe catalog error", async () => {
    const executor = fakeExecutor().executor;
    executor.execute = async () => {
      throw new Error("database password");
    };
    await expect(
      new MySqlCatalogWriter(executor).beginIndexRun({
        knowledgeId: "doc-1",
        sourceRevision: "rev-1",
        model: "test",
        dimension: 3,
      }),
    ).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      message: "Knowledge index unavailable",
    });
  });
});
