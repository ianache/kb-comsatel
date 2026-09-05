import { describe, expect, it } from "vitest";
import { DeterministicEmbeddingProvider } from "../../src/retrieval/deterministic-embedding-provider.js";
import { IngestionIndexer } from "../../src/retrieval/ingestion-indexer.js";
import type { CatalogWriter } from "../../src/retrieval/catalog-writer.js";
import type { DocumentSource } from "../../src/retrieval/document-source.js";
import type { SourceDocument } from "../../src/retrieval/source-document.js";
import type {
  VectorPoint,
  VectorStore,
} from "../../src/retrieval/vector-store.js";

function document(revision: string, content: string): SourceDocument {
  return {
    knowledgeId: "rule-1",
    title: "Stable rule",
    artifactType: "rule",
    sourceSystem: "gitlab",
    sourceUri: `gitlab://587/-/blob/main/knowledge/rule.md`,
    sourceRevision: revision,
    product: "cgo",
    domain: "operations",
    classification: "internal",
    status: "stable",
    content,
    locator: {},
    acl: {
      principalIds: [],
      roles: [],
      groups: [],
      products: [],
      domains: [],
      classifications: ["internal"],
    },
  };
}

function source(value: SourceDocument): DocumentSource {
  return {
    async *list() {
      yield value;
    },
  };
}

function catalog(
  states: Map<string, { contentHash: string; indexed: boolean }>,
): CatalogWriter {
  return {
    getRevisionState: async (knowledgeId, revision) =>
      states.get(`${knowledgeId}:${revision}`) ?? null,
    beginIndexRun: async () => "run-1",
    upsertDocument: async (item, contentHash) => {
      states.set(`${item.knowledgeId}:${item.sourceRevision}`, {
        contentHash,
        indexed: false,
      });
    },
    replaceChunks: async () => undefined,
    completeIndexRun: async (_runId, counts) => {
      for (const [key, item] of states) {
        if (!item.indexed)
          states.set(key, { ...item, indexed: counts.chunks > 0 });
      }
    },
    failIndexRun: async () => undefined,
  };
}

function vectors(points: VectorPoint[]): VectorStore {
  return {
    ensureCollection: async () => undefined,
    upsert: async (items) => points.push(...items),
    deleteByRevision: async () => undefined,
    search: async () => [],
    health: async () => undefined,
    close: async () => undefined,
  };
}

describe("I5-B idempotence", () => {
  it("skips the same GitLab revision and indexes a changed revision once", async () => {
    const states = new Map<string, { contentHash: string; indexed: boolean }>();
    const points: VectorPoint[] = [];
    const options = {
      chunk: { targetChars: 80, overlapChars: 10, maxChars: 100 },
    };

    const first = await new IngestionIndexer(
      source(document("commit-1", "first content")),
      new DeterministicEmbeddingProvider("local-test", 3),
      vectors(points),
      catalog(states),
      options,
    ).ingest();
    const repeated = await new IngestionIndexer(
      source(document("commit-1", "first content")),
      new DeterministicEmbeddingProvider("local-test", 3),
      vectors(points),
      catalog(states),
      options,
    ).ingest();
    const changed = await new IngestionIndexer(
      source(document("commit-2", "changed content")),
      new DeterministicEmbeddingProvider("local-test", 3),
      vectors(points),
      catalog(states),
      options,
    ).ingest();

    expect(first).toMatchObject({ processed: 1, skipped: 0, failed: 0 });
    expect(repeated).toMatchObject({ processed: 0, skipped: 1, failed: 0 });
    expect(changed).toMatchObject({ processed: 1, skipped: 0, failed: 0 });
    expect(states.get("rule-1:commit-1")?.indexed).toBe(true);
    expect(states.get("rule-1:commit-2")?.indexed).toBe(true);
    expect(points.map((point) => point.payload.sourceRevision)).toContain(
      "commit-2",
    );
  });
});
