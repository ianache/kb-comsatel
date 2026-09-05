import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { DeterministicEmbeddingProvider } from "../../src/retrieval/deterministic-embedding-provider.js";
import { fuseSearchResults } from "../../src/retrieval/score-fusion.js";

describe("I3 acceptance invariants", () => {
  it("keeps I3 disabled by default and produces stable embeddings", async () => {
    expect(loadConfig({}).i3Enabled).toBe(false);
    const provider = new DeterministicEmbeddingProvider("local-test", 3);
    await expect(provider.embed(["same text", "same text"])).resolves.toEqual(
      expect.objectContaining({
        model: "local-test",
        dimension: 3,
        vectors: expect.any(Array),
      }),
    );
    const result = await provider.embed(["same text"]);
    const repeated = await provider.embed(["same text"]);
    expect(result.vectors).toEqual(repeated.vectors);
  });

  it("keeps hybrid ordering deterministic and deduplicates public knowledge", () => {
    const lexical = [
      {
        knowledgeId: "a",
        excerpt: "lexical",
        relevanceScore: 1,
        trust: "verified" as const,
        citation: {} as never,
      },
    ];
    const vector = [
      {
        chunkId: "chunk-a",
        score: 0.9,
        result: {
          knowledgeId: "a",
          excerpt: "vector",
          relevanceScore: 0,
          trust: "verified" as const,
          citation: {} as never,
        },
      },
      {
        chunkId: "chunk-b",
        score: 0.8,
        result: {
          knowledgeId: "b",
          excerpt: "vector",
          relevanceScore: 0,
          trust: "verified" as const,
          citation: {} as never,
        },
      },
    ];
    const first = fuseSearchResults(lexical, vector, 20, {
      lexicalWeight: 0.35,
      vectorWeight: 0.65,
    });
    const second = fuseSearchResults(lexical, vector, 20, {
      lexicalWeight: 0.35,
      vectorWeight: 0.65,
    });
    expect(first).toEqual(second);
    expect(first.map((item) => item.knowledgeId)).toEqual(["a", "b"]);
  });
});
