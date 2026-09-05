import { expect, it } from "vitest";
import { HybridKnowledgeRepository } from "../../src/catalog/hybrid-repository.js";
import type { KnowledgeRepository } from "../../src/catalog/repository.js";
import type {
  AccessPrincipal,
  SearchKnowledgeResult,
} from "../../src/domain/schemas.js";
import type { ChunkReader } from "../../src/retrieval/chunk-reader.js";
import type { EmbeddingProvider } from "../../src/retrieval/embedding-provider.js";
import type { VectorStore } from "../../src/retrieval/vector-store.js";

const principal: AccessPrincipal = {
  id: "user-1",
  roles: [],
  groups: ["reviewers"],
  products: ["cgo"],
  domains: ["units"],
  classifications: ["internal"],
};

const result: SearchKnowledgeResult["results"][number] = {
  knowledgeId: "doc-1",
  excerpt: "authorized excerpt",
  relevanceScore: 0.9,
  trust: "verified",
  citation: {
    knowledgeId: "doc-1",
    title: "Document",
    sourceUri: "https://example.test/doc-1",
    sourceRevision: "rev-1",
    sourceSystem: "gitlab",
    scope: { product: "cgo", domain: "units" },
    status: "stable",
  },
};

const lexical: KnowledgeRepository = {
  search: async () => ({
    results: [result],
    appliedFilters: {},
    evidenceStatus: "sufficient",
    warnings: [],
  }),
  getExcerpt: async () => null,
  getLineage: async () => null,
  getProvenance: async () => null,
  listStale: async () => [],
  getArtifact: async () => null,
  getTaxonomy: async () => null,
};

it("hydrates vector IDs through the authorized chunk reader and preserves public schemas", async () => {
  const chunks: ChunkReader = {
    readSearchItems: async () => [{ chunkId: "chunk-1", result }],
  };
  const vectors: VectorStore = {
    ensureCollection: async () => undefined,
    upsert: async () => undefined,
    deleteByRevision: async () => undefined,
    search: async () => [{ id: "chunk-1", score: 0.9, payload: {} as never }],
    health: async () => undefined,
    close: async () => undefined,
  };
  const embeddings: EmbeddingProvider = {
    embed: async () => ({ model: "test", dimension: 3, vectors: [[1, 0, 0]] }),
  };
  const repository = new HybridKnowledgeRepository(
    lexical,
    chunks,
    vectors,
    embeddings,
    { lexicalWeight: 0.35, vectorWeight: 0.65, candidateMultiplier: 3 },
  );

  const response = await repository.search(
    { query: "unit", limit: 8 },
    principal,
  );
  expect(response.results[0]?.excerpt).toBe("authorized excerpt");
  expect(response.results[0]?.citation.knowledgeId).toBe("doc-1");
});

it("falls back to lexical evidence when vector retrieval fails", async () => {
  const repository = new HybridKnowledgeRepository(
    lexical,
    { readSearchItems: async () => [] },
    {
      ensureCollection: async () => undefined,
      upsert: async () => undefined,
      deleteByRevision: async () => undefined,
      search: async () => {
        throw new Error("qdrant unavailable");
      },
      health: async () => undefined,
      close: async () => undefined,
    },
    {
      embed: async () => ({
        model: "test",
        dimension: 3,
        vectors: [[1, 0, 0]],
      }),
    },
    { lexicalWeight: 0.35, vectorWeight: 0.65, candidateMultiplier: 3 },
  );

  await expect(
    repository.search({ query: "unit", limit: 8 }, principal),
  ).resolves.toMatchObject({
    results: [result],
  });
});
