# Task 2: Define domain schemas and safe errors

## Files

- Create `src/domain/schemas.ts`, `src/domain/errors.ts`, and `tests/domain/schemas.test.ts`.
- Modify `src/config.ts` only if a shared validation type is needed; preserve Task 1 defaults.

## Required interfaces

- Export Zod schemas and inferred TypeScript types for `KnowledgeFilters`, `Citation`, `SearchKnowledgeInput`, `SearchKnowledgeResult`, `AccessPrincipal`, `KnowledgeArtifact`, `KnowledgeExcerpt`, `ArtifactLineage`, `Provenance`, `ContextPack`, `StaleConcept`, and `Taxonomy`.
- Model statuses exactly as `stable | draft | deprecated | superseded | archived`.
- Model source systems exactly as `gitlab | google-drive | okf | schema-catalog`.
- Search input has non-empty `query`, `limit` default `8`, and limit range `1..20`.
- Context pack input has `task`, `product`, `tokenBudget` range `500..12000`, and filters.
- Citations require `knowledgeId`, `title`, `sourceUri`, `sourceRevision`, and `status`; locator fields `sectionPath`, `pageRange`, and `lineRange` are optional.
- Use strict objects and valid non-empty identifier/URI strings.
- Define `KcpErrorCode` exactly as `INVALID_INPUT | NOT_FOUND | FORBIDDEN | INSUFFICIENT_EVIDENCE | INTERNAL_ERROR`.
- Export `KcpError` storing only `code`, safe `message`, and optional `correlationId`; serialization must not expose stacks or causes.

## Required tests

```ts
import { expect, it } from "vitest";
import { buildContextPackInputSchema, searchKnowledgeInputSchema } from "../../src/domain/schemas.js";

it("rejects a search limit outside 1..20", () => {
  expect(searchKnowledgeInputSchema.safeParse({ query: "rules", limit: 21 }).success).toBe(false);
});

it("rejects a context budget outside 500..12000", () => {
  expect(buildContextPackInputSchema.safeParse({ task: "task", product: "cgo", tokenBudget: 499 }).success).toBe(false);
});
```

## Validation

Run `npm test -- tests/domain/schemas.test.ts`, `npm run typecheck`, and `npm run format:check`. Write `.superpowers/sdd/2026-08-29-knowledge-context-mcp-i1/task-2-report.md` with exact commands and outputs.

## Constraints

- Do not dispatch subagents or commit.
- Do not implement the repository, engine, MCP adapter, external services, or health server.
- Preserve unrelated existing work and the Task 1 public defaults.
