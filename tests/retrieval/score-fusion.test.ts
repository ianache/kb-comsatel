import { expect, it } from "vitest";
import { fuseSearchResults } from "../../src/retrieval/score-fusion.js";
import type { SearchKnowledgeResult } from "../../src/domain/schemas.js";

function result(
  knowledgeId: string,
  relevanceScore = 1,
): SearchKnowledgeResult["results"][number] {
  return {
    knowledgeId,
    excerpt: `${knowledgeId} excerpt`,
    relevanceScore,
    trust: "verified",
    citation: {
      knowledgeId,
      title: knowledgeId,
      sourceUri: `https://example.test/${knowledgeId}`,
      sourceRevision: "rev-1",
      sourceSystem: "gitlab",
      scope: { product: "cgo", domain: "units" },
      status: "stable",
    },
  };
}

it("fuses lexical and vector ranks deterministically and deduplicates knowledge IDs", () => {
  const fused = fuseSearchResults(
    [result("lexical-first"), result("shared")],
    [
      { chunkId: "chunk-shared", score: 0.9, result: result("shared", 0.9) },
      {
        chunkId: "vector-only",
        score: 0.8,
        result: result("vector-only", 0.8),
      },
    ],
    3,
    { lexicalWeight: 0.35, vectorWeight: 0.65 },
  );

  expect(fused).toHaveLength(3);
  expect(new Set(fused.map((item) => item.knowledgeId)).size).toBe(3);
  expect(fused.map((item) => item.relevanceScore)).toEqual(
    [...fused.map((item) => item.relevanceScore)].sort((a, b) => b - a),
  );
});
