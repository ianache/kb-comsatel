import { describe, expect, it } from "vitest";
import { QdrantVectorStore } from "../../src/retrieval/qdrant-vector-store.js";
import type { VectorPoint } from "../../src/retrieval/vector-store.js";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const point: VectorPoint = {
  id: "chunk-1",
  vector: [1, 0, 0],
  payload: {
    chunkId: "chunk-1",
    knowledgeId: "doc-1",
    sourceRevision: "rev-1",
    product: "cgo",
    domain: "units",
    classification: "internal",
    status: "stable",
    sourceSystem: "gitlab",
    verified: true,
    stale: false,
  },
};

describe("QdrantVectorStore", () => {
  it("creates a missing collection, upserts points, and bounds search", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const store = new QdrantVectorStore({
      url: "http://qdrant.test:6333",
      collection: "knowledge_chunks",
      fetcher: async (url, init) => {
        calls.push({ url: String(url), init });
        if (calls.length === 1) return response({}, 404);
        if (calls.length === 2) return response({ result: true });
        if (calls.length === 3) return response({ result: true });
        return response({
          result: {
            points: [{ id: "chunk-1", score: 0.9, payload: point.payload }],
          },
        });
      },
    });

    await store.ensureCollection({
      name: "knowledge_chunks",
      dimension: 3,
      distance: "Cosine",
      model: "test",
    });
    await store.upsert([point]);
    const results = await store.search({
      vector: [1, 0, 0],
      principal: {
        id: "user-1",
        roles: [],
        groups: ["reviewers"],
        products: ["cgo"],
        domains: ["units"],
        classifications: ["internal"],
      },
      limit: 20,
    });

    expect(results[0]?.id).toBe("chunk-1");
    expect(JSON.parse(String(calls[1]?.init?.body))).toMatchObject({
      vectors: { size: 3, distance: "Cosine" },
    });
    expect(JSON.parse(String(calls[3]?.init?.body)).limit).toBe(20);
  });

  it("rejects an existing collection with the wrong dimension", async () => {
    const store = new QdrantVectorStore({
      url: "http://qdrant.test:6333",
      collection: "knowledge_chunks",
      fetcher: async () =>
        response({
          result: {
            config: { params: { vectors: { size: 4, distance: "Cosine" } } },
          },
        }),
    });

    await expect(
      store.ensureCollection({
        name: "knowledge_chunks",
        dimension: 3,
        distance: "Cosine",
        model: "test",
      }),
    ).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      message: "Vector collection incompatible",
    });
  });
});
