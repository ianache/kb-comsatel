# Task 4: Implement the reusable context engine and audit sink

## Files

- Create `src/engine/audit.ts`, `src/engine/context-engine.ts`, and `tests/engine/context-engine.test.ts`.

## Required interfaces

- Consume `KnowledgeRepository` and domain schemas from Tasks 2–3.
- Export `ContextEngine` methods: `searchKnowledge`, `getKnowledgeExcerpt`, `getArtifactLineage`, `buildContextPack`, `getTaskContext`, `getProvenance`, and `listStaleConcepts`.
- Export `AuditSink`, `MemoryAuditSink`, and `AuditEvent`.
- Audit fields: `correlationId`, `principalId`, `operation`, `filterKeys`, `resultCount`, `authorization`, `evidenceStatus`, `latencyMs`; never store query/prompt/excerpt/JWT/secret text.
- Search delegates to repository, adds warnings for draft/deprecated/superseded/stale, preserves citations, and returns `insufficient` with no invented results when empty.
- Context packs accept `task`, `product`, `tokenBudget` (`500..12000`), and required filters; never exceed budget; include restrictions, facts, decisions, related artifacts, conflicts, missing knowledge, and citation-bearing excerpts.
- If the first excerpt exceeds budget, return empty excerpts and `insufficient` rather than truncating a citation-bearing fact.
- `getTaskContext` extracts Issue/MR identifiers for ranking only; it never calls GitLab.

## Required tests

```ts
it("returns insufficient evidence without inventing results", async () => {
  const engine = new ContextEngine(createSeedRepository(), new MemoryAuditSink());
  const result = await engine.searchKnowledge({ query: "unknown matter", limit: 8 }, publicPrincipal);
  expect(result.evidenceStatus).toBe("insufficient");
  expect(result.results).toEqual([]);
});

it("keeps a context pack within its token budget", async () => {
  const engine = new ContextEngine(createSeedRepository(), new MemoryAuditSink());
  const result = await engine.buildContextPack({ task: "premium unit rules", product: "cgo", tokenBudget: 500, filters: {} }, publicPrincipal);
  expect(result.estimatedTokens).toBeLessThanOrEqual(500);
  expect(result.excerpts.every((excerpt) => excerpt.citation.knowledgeId.length > 0)).toBe(true);
});
```

## Validation

Run `npm test -- tests/engine/context-engine.test.ts`, `npm run typecheck`, and `npm run format:check`. Write exact evidence to `.superpowers/sdd/2026-08-29-knowledge-context-mcp-i1/task-4-report.md`.

## Constraints

- Do not dispatch subagents or commit.
- Do not implement MCP adapter, health server, external services, or source connectors.
- Preserve Tasks 1–3 and unrelated files.
