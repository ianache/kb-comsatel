import type { SearchKnowledgeResult } from "../domain/schemas.js";
import type { HydratedChunk } from "./chunk-reader.js";

export interface VectorCandidate {
  chunkId: string;
  score: number;
  result: SearchKnowledgeResult["results"][number];
}

export interface ScoreFusionOptions {
  lexicalWeight: number;
  vectorWeight: number;
  reciprocalRankConstant?: number;
}

export function fuseSearchResults(
  lexical: SearchKnowledgeResult["results"],
  vector: readonly VectorCandidate[],
  limit: number,
  options: ScoreFusionOptions,
): SearchKnowledgeResult["results"] {
  const scores = new Map<
    string,
    {
      score: number;
      chunkId: string;
      result: SearchKnowledgeResult["results"][number];
    }
  >();
  const constant = options.reciprocalRankConstant ?? 60;
  lexical.forEach((result, index) => {
    const key = result.knowledgeId;
    const score = options.lexicalWeight / (constant + index + 1);
    const current = scores.get(key);
    if (!current || score > current.score)
      scores.set(key, { score, chunkId: key, result });
  });
  vector.forEach((candidate, index) => {
    const key = candidate.result.knowledgeId;
    const score = options.vectorWeight / (constant + index + 1);
    const current = scores.get(key);
    if (current) {
      current.score += score;
      if (candidate.result.relevanceScore > current.result.relevanceScore) {
        current.result = candidate.result;
        current.chunkId = candidate.chunkId;
      }
    } else {
      scores.set(key, {
        score,
        chunkId: candidate.chunkId,
        result: candidate.result,
      });
    }
  });
  return [...scores.values()]
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.result.knowledgeId.localeCompare(right.result.knowledgeId) ||
        left.chunkId.localeCompare(right.chunkId),
    )
    .slice(0, Math.min(20, Math.max(1, limit)))
    .map(({ score, result }) => ({ ...result, relevanceScore: score }));
}

export function vectorCandidatesFromHydrated(
  ids: readonly { id: string; score: number }[],
  hydrated: readonly HydratedChunk[],
): VectorCandidate[] {
  const byId = new Map(hydrated.map((item) => [item.chunkId, item]));
  return ids.flatMap((item) => {
    const value = byId.get(item.id);
    return value === undefined
      ? []
      : [{ chunkId: item.id, score: item.score, result: value.result }];
  });
}
