# Task 3: Build the repository boundary and seeded catalog

## Files

- Create `src/catalog/repository.ts`, `src/catalog/memory-repository.ts`, `src/catalog/seed.ts`, and `tests/catalog/memory-repository.test.ts`.

## Required interfaces

- Consume domain schemas/errors from Task 2.
- Export `KnowledgeRepository` methods: `search`, `getExcerpt`, `getLineage`, `getProvenance`, `listStale`, `getArtifact`, and `getTaxonomy`.
- Every method accepts `AccessPrincipal`; direct artifact lookups return `null` for missing and unauthorized artifacts.
- Export `MemoryKnowledgeRepository` and `createSeedRepository()`.
- Apply product/domain/type/status/source/verified/stale ACL filters before ranking.
- Use deterministic case-insensitive term-overlap ranking; do not claim semantic vector search.
- Seed at least: public stable unit rule, restricted stable architecture decision requiring `architecture-reviewers`, and superseded delivery artifact pointing to a stable successor.
- Include citations/provenance with URI, revision, hash, status, source, scope, and locators; include taxonomy for `cgo`.

## Required test behavior

```ts
const publicPrincipal = { id: "dev-1", roles: ["developer"], groups: [], products: ["cgo"], domains: ["units"], classifications: ["internal"] };
const restrictedPrincipal = { ...publicPrincipal, groups: ["architecture-reviewers"] };

it("returns stable public evidence", async () => {
  const result = await createSeedRepository().search({ query: "premium unit", limit: 8 }, publicPrincipal);
  expect(result.results[0]?.citation.status).toBe("stable");
  expect(result.results[0]?.citation.sourceUri).toMatch(/^https:\/\//);
});

it("does not reveal restricted artifacts without the group", async () => {
  const result = await createSeedRepository().search({ query: "architecture decision", limit: 8 }, publicPrincipal);
  expect(result.results).toHaveLength(0);
  expect(await createSeedRepository().getArtifact("artifact-restricted-adr", undefined, publicPrincipal)).toBeNull();
  expect(await createSeedRepository().getArtifact("artifact-restricted-adr", undefined, restrictedPrincipal)).not.toBeNull();
});
```

## Validation

Run `npm test -- tests/catalog/memory-repository.test.ts`, `npm run typecheck`, and `npm run format:check`. Write exact outputs to `.superpowers/sdd/2026-08-29-knowledge-context-mcp-i1/task-3-report.md`.

## Constraints

- Do not dispatch subagents or commit.
- Do not implement the context engine, MCP adapter, health server, or external services.
- Preserve Tasks 1–2 and unrelated user files.
