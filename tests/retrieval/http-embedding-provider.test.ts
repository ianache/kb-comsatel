import { describe, expect, it } from "vitest";
import { HttpEmbeddingProvider } from "../../src/retrieval/http-embedding-provider.js";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("HttpEmbeddingProvider", () => {
  it("batches texts and validates ordered vectors", async () => {
    let received: { url: string; init?: RequestInit } | undefined;
    const provider = new HttpEmbeddingProvider({
      url: "https://embedding.test/v1/embeddings",
      model: "test-model",
      dimension: 3,
      timeoutMs: 1000,
      fetcher: async (url, init) => {
        received = { url: String(url), init };
        return response({
          data: [{ embedding: [1, 0, 0] }, { embedding: [0, 1, 0] }],
        });
      },
    });

    await expect(provider.embed(["one", "two"])).resolves.toMatchObject({
      model: "test-model",
      dimension: 3,
      vectors: [
        [1, 0, 0],
        [0, 1, 0],
      ],
    });
    expect(received?.url).toBe("https://embedding.test/v1/embeddings");
    expect(String(received?.init?.body)).toContain('"input":["one","two"]');
  });

  it("rejects a dimension mismatch without exposing credentials", async () => {
    const provider = new HttpEmbeddingProvider({
      url: "https://embedding.test/v1/embeddings",
      model: "test-model",
      apiKey: "secret-api-key",
      dimension: 3,
      timeoutMs: 1000,
      fetcher: async () => response({ data: [{ embedding: [1, 2] }] }),
    });

    await expect(provider.embed(["one"])).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      message: "Embedding response unavailable",
    });
    await expect(provider.embed(["one"])).rejects.not.toThrow("secret-api-key");
  });
});
