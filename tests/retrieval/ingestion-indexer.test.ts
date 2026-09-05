import { describe, expect, it } from "vitest";
import { DeterministicEmbeddingProvider } from "../../src/retrieval/deterministic-embedding-provider.js";
import { FilesystemDocumentSource } from "../../src/retrieval/filesystem-document-source.js";
import { IngestionIndexer } from "../../src/retrieval/ingestion-indexer.js";
import type { CatalogWriter } from "../../src/retrieval/catalog-writer.js";
import type {
  VectorPoint,
  VectorStore,
} from "../../src/retrieval/vector-store.js";

function fakeCatalog(
  states = new Map<string, { contentHash: string; indexed: boolean }>(),
): CatalogWriter {
  return {
    getRevisionState: async (knowledgeId, sourceRevision) =>
      states.get(`${knowledgeId}:${sourceRevision}`) ?? null,
    beginIndexRun: async () => "run-1",
    upsertDocument: async (document, contentHash) => {
      states.set(`${document.knowledgeId}:${document.sourceRevision}`, {
        contentHash,
        indexed: false,
      });
    },
    replaceChunks: async () => undefined,
    completeIndexRun: async (_runId, counts) => {
      for (const [key, state] of states) {
        if (!state.indexed) {
          states.set(key, { ...state, indexed: counts.chunks > 0 });
          break;
        }
      }
    },
    failIndexRun: async () => undefined,
  };
}

function fakeVectors(points: VectorPoint[] = []): VectorStore {
  return {
    ensureCollection: async () => undefined,
    upsert: async (newPoints) => points.push(...newPoints),
    deleteByRevision: async () => undefined,
    search: async () => [],
    health: async () => undefined,
    close: async () => undefined,
  };
}

describe("IngestionIndexer", () => {
  it("indexes fixture documents and skips an already indexed revision", async () => {
    const source = new FilesystemDocumentSource({ directory: "fixtures/i3" });
    const states = new Map<string, { contentHash: string; indexed: boolean }>();
    const catalog = fakeCatalog(states);
    const points: VectorPoint[] = [];
    const first = await new IngestionIndexer(
      source,
      new DeterministicEmbeddingProvider("local-test", 3),
      fakeVectors(points),
      catalog,
      { chunk: { targetChars: 80, overlapChars: 10, maxChars: 100 } },
    ).ingest();

    expect(first.processed).toBe(2);
    expect(first.vectors).toBe(points.length);
    expect(points.length).toBeGreaterThan(0);

    const second = await new IngestionIndexer(
      new FilesystemDocumentSource({ directory: "fixtures/i3" }),
      new DeterministicEmbeddingProvider("local-test", 3),
      fakeVectors(),
      catalog,
      { chunk: { targetChars: 80, overlapChars: 10, maxChars: 100 } },
    ).ingest();
    expect(second.processed).toBe(0);
    expect(second.skipped).toBe(2);
  });

  it("persists the revision before creating its foreign-keyed index run", async () => {
    const events: string[] = [];
    const catalog = fakeCatalog();
    const originalUpsert = catalog.upsertDocument;
    catalog.upsertDocument = async (...args) => {
      events.push("upsert");
      await originalUpsert(...args);
    };
    catalog.beginIndexRun = async () => {
      events.push("begin");
      return "run-1";
    };

    await new IngestionIndexer(
      new FilesystemDocumentSource({ directory: "fixtures/i3" }),
      new DeterministicEmbeddingProvider("local-test", 3),
      fakeVectors(),
      catalog,
      { chunk: { targetChars: 80, overlapChars: 10, maxChars: 100 } },
    ).ingest();

    expect(events.slice(0, 2)).toEqual(["upsert", "begin"]);
  });

  it("marks failures and removes partial vectors", async () => {
    let failed = false;
    const source = new FilesystemDocumentSource({ directory: "fixtures/i3" });
    const catalog = fakeCatalog();
    catalog.failIndexRun = async (_runId, code) => {
      failed = code === "EMBEDDING_UNAVAILABLE";
    };
    const vectors = fakeVectors();
    const embeddings = {
      embed: async () => {
        throw new Error("embedding endpoint secret");
      },
    };

    await expect(
      new IngestionIndexer(source, embeddings, vectors, catalog, {
        chunk: { targetChars: 80, overlapChars: 10, maxChars: 100 },
      }).ingest(),
    ).rejects.toThrow("embedding endpoint secret");
    expect(failed).toBe(true);
  });
});
