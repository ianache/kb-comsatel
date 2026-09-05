# Knowledge Context MCP I1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a runnable TypeScript/Node.js I1 MCP foundation with stdio transport, validated read-only knowledge contracts, a reusable context engine, mock catalog, operational health checks, tests, and GitLab CI.

**Architecture:** MCP registration stays in `src/mcp`, while all retrieval, evidence, authorization, budgeting, lineage, and audit behavior lives behind `ContextEngine` and `KnowledgeRepository` interfaces. I1 uses an in-memory repository and local principal; later increments replace those adapters with MySQL, Qdrant, Keycloak, and Vault without changing the public MCP contracts.

**Tech Stack:** Node.js 22 LTS, TypeScript 5.x, official `@modelcontextprotocol/sdk`, Zod 3.x, Fastify 5.x, Vitest 3.x, npm lockfile.

**Spec:** `docs/superpowers/specs/2026-08-29-knowledge-context-mcp-i1-design.md`

## Global Constraints

- The server is strictly read-only; it must not expose mutation, source-system, database, or Vault tools.
- Every tool output containing content includes one or more citations.
- Unauthorized artifacts expose neither metadata nor candidate results; use a safe not-found response for direct resource lookups.
- Stable, draft, deprecated, superseded, and archived statuses remain explicit in citations and warnings.
- Search limits are `1..20` with default `8`; context budgets are `500..12000` tokens.
- Audit events contain identity and aggregate outcome data, never raw prompts, JWTs, secrets, or complete document text.
- No MySQL, Qdrant, Keycloak, Vault, Airflow, web UI, or Streamable HTTP implementation is part of I1.
- Use `npm run format:check`, `npm run typecheck`, and `npm test` as the local quality gate.

---

### Task 1: Scaffold the TypeScript service

**Files:**
- Create: `package.json`
- Create: `package-lock.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `src/config.ts`
- Create: `src/server.ts`
- Create: `tests/config.test.ts`

**Interfaces:**
- Consumes: no project code.
- Produces: `loadConfig(): AppConfig`, `createApplication(): Promise<Application>`, npm scripts `dev`, `build`, `start`, `typecheck`, `test`, `format`, and `format:check`.

- [x] **Step 1: Write the failing configuration test**

```ts
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";

describe("loadConfig", () => {
  it("uses safe local defaults", () => {
    expect(loadConfig({})).toEqual({
      host: "127.0.0.1",
      port: 8787,
      logLevel: "info",
    });
  });
});
```

- [x] **Step 2: Run the focused test and confirm it fails**

Run: `npm test -- tests/config.test.ts`

Expected: FAIL because the package and `loadConfig` do not exist.

- [x] **Step 3: Add package and compiler configuration**

Pin Node-compatible dependencies in `package.json`: `@modelcontextprotocol/sdk`, `fastify`, `zod`, and `pino`; pin development dependencies `typescript`, `tsx`, `vitest`, `prettier`, and `@types/node`. Configure ESM with `"type": "module"`, compile `src` to `dist`, and use `NodeNext` module resolution.

- [x] **Step 4: Implement configuration and an application composition seam**

Implement `AppConfig` with `host: string`, `port: number`, and `logLevel: "debug" | "info" | "warn" | "error"`. Parse environment values with Zod and reject invalid ports instead of silently coercing them. Define `Application` as `{ start(): Promise<void>; close(): Promise<void> }`; keep its composition implementation minimal until the adapters exist.

- [x] **Step 5: Run the focused test and quality checks**

Run: `npm test -- tests/config.test.ts && npm run typecheck`

Expected: PASS with no type errors.

- [x] **Step 6: Add repository hygiene files**

Ignore `node_modules`, `dist`, `.env`, coverage output, and local generated graph/output folders. Keep `.env.example` limited to `KCP_HOST`, `KCP_PORT`, and `KCP_LOG_LEVEL` with no credentials.

### Task 2: Define domain schemas and safe errors

**Files:**
- Create: `src/domain/schemas.ts`
- Create: `src/domain/errors.ts`
- Create: `tests/domain/schemas.test.ts`
- Modify: `src/config.ts`

**Interfaces:**
- Consumes: `AppConfig` from Task 1.
- Produces: Zod schemas and inferred types for `KnowledgeFilters`, `Citation`, `SearchKnowledgeInput`, `SearchKnowledgeResult`, `AccessPrincipal`, `KnowledgeArtifact`, `KnowledgeExcerpt`, `ArtifactLineage`, `Provenance`, `ContextPack`, `StaleConcept`, and `Taxonomy`; `KcpError` with stable codes.

- [x] **Step 1: Write schema rejection tests**

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

- [x] **Step 2: Run the focused tests and confirm they fail**

Run: `npm test -- tests/domain/schemas.test.ts`

Expected: FAIL because the schemas do not exist.

- [x] **Step 3: Implement the schemas**

Use strict objects. Model `status` as the five PRD values and `sourceSystem` as `gitlab | google-drive | okf | schema-catalog`. Set search `limit` default to `8`. Require a non-empty query and valid URI/ID strings. Define citation locators with optional `sectionPath`, `pageRange`, and `lineRange`; require `knowledgeId`, `title`, `sourceUri`, `sourceRevision`, and `status`.

- [x] **Step 4: Implement structured errors**

Define `KcpErrorCode` as `INVALID_INPUT | NOT_FOUND | FORBIDDEN | INSUFFICIENT_EVIDENCE | INTERNAL_ERROR`. `KcpError` stores only `code`, safe `message`, and optional `correlationId`; its MCP serialization must never include stack traces or causes.

- [x] **Step 5: Run schema, type, and formatting checks**

Run: `npm test -- tests/domain/schemas.test.ts && npm run typecheck && npm run format:check`

Expected: PASS.

### Task 3: Build the repository boundary and seeded catalog

**Files:**
- Create: `src/catalog/repository.ts`
- Create: `src/catalog/memory-repository.ts`
- Create: `src/catalog/seed.ts`
- Create: `tests/catalog/memory-repository.test.ts`

**Interfaces:**
- Consumes: domain schemas and errors from Task 2.
- Produces: `KnowledgeRepository`, `MemoryKnowledgeRepository`, `createSeedRepository()`, and `AccessPrincipal`-based authorization behavior.

- [x] **Step 1: Write repository authorization tests**

```ts
import { describe, expect, it } from "vitest";
import { createSeedRepository } from "../../src/catalog/seed.js";

const publicPrincipal = { id: "dev-1", roles: ["developer"], groups: [], products: ["cgo"], domains: ["units"], classifications: ["internal"] };
const restrictedPrincipal = { ...publicPrincipal, groups: ["architecture-reviewers"] };

describe("MemoryKnowledgeRepository", () => {
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
});
```

- [x] **Step 2: Run the focused tests and confirm they fail**

Run: `npm test -- tests/catalog/memory-repository.test.ts`

Expected: FAIL because the repository and seed data do not exist.

- [x] **Step 3: Define the repository interface**

Implement the methods from the design: `search`, `getExcerpt`, `getLineage`, `getProvenance`, `listStale`, `getArtifact`, and `getTaxonomy`. Every method accepts `AccessPrincipal`; direct artifact lookups return `null` for both missing and unauthorized artifacts.

- [x] **Step 4: Implement deterministic in-memory filtering and ranking**

Store typed artifacts with bounded excerpts, source metadata, content hashes, ACL groups, product/domain scope, revisions, status, and optional successor. Filter product/domain/type/status/source/verified/stale before scoring. Use simple case-insensitive term overlap for I1 ranking; do not pretend it is semantic vector search.

- [x] **Step 5: Add seed fixtures**

Create at least three artifacts: a public `stable` unit rule, a restricted `stable` architecture decision requiring `architecture-reviewers`, and a `superseded` delivery artifact pointing to a stable successor. Include taxonomy data for `cgo` and enough provenance fields to exercise citations, hashes, revisions, and section/page locators.

- [x] **Step 6: Run repository tests and type checks**

Run: `npm test -- tests/catalog/memory-repository.test.ts && npm run typecheck`

Expected: PASS.

### Task 4: Implement the reusable context engine and audit sink

**Files:**
- Create: `src/engine/audit.ts`
- Create: `src/engine/context-engine.ts`
- Create: `tests/engine/context-engine.test.ts`

**Interfaces:**
- Consumes: `KnowledgeRepository` and domain schemas from Task 3.
- Produces: `ContextEngine` methods `searchKnowledge`, `getKnowledgeExcerpt`, `getArtifactLineage`, `buildContextPack`, `getTaskContext`, `getProvenance`, and `listStaleConcepts`; `AuditSink` and `MemoryAuditSink`.

- [x] **Step 1: Write engine behavior tests**

```ts
import { expect, it } from "vitest";
import { createSeedRepository } from "../../src/catalog/seed.js";
import { ContextEngine } from "../../src/engine/context-engine.js";
import { MemoryAuditSink } from "../../src/engine/audit.js";

it("returns insufficient evidence without inventing results", async () => {
  const engine = new ContextEngine(createSeedRepository(), new MemoryAuditSink());
  const result = await engine.searchKnowledge({ query: "unknown matter", limit: 8 }, publicPrincipal);
  expect(result.evidenceStatus).toBe("insufficient");
  expect(result.results).toEqual([]);
});

it("keeps a context pack within its token budget", async () => {
  const engine = new ContextEngine(createSeedRepository(), new MemoryAuditSink());
  const result = await engine.buildContextPack({ task: "premium unit rules", product: "cgo", tokenBudget: 500 }, publicPrincipal);
  expect(result.estimatedTokens).toBeLessThanOrEqual(500);
  expect(result.excerpts.every((excerpt) => excerpt.citation.knowledgeId.length > 0)).toBe(true);
});
```

- [x] **Step 2: Run the focused tests and confirm they fail**

Run: `npm test -- tests/engine/context-engine.test.ts`

Expected: FAIL because the engine and audit sink do not exist.

- [x] **Step 3: Implement aggregate audit events**

Define `AuditEvent` with `correlationId`, `principalId`, `operation`, `filterKeys`, `resultCount`, `authorization`, `evidenceStatus`, and `latencyMs`. `MemoryAuditSink` stores events for tests. Never include query text, prompt text, excerpt text, token, secret, or JWT fields.

- [x] **Step 4: Implement search and direct retrieval policies**

Delegate candidate retrieval to the repository, then add warnings for `draft`, `deprecated`, `superseded`, and stale artifacts. Return `insufficient` when no authorized evidence remains. Ensure every content-bearing result retains its citation.

- [x] **Step 5: Implement context-pack selection**

Search using the task and product, sort by relevance, append bounded excerpts while estimated UTF-8 characters divided by four stays within `tokenBudget`, and return restrictions, facts, decisions, related artifacts, conflicts, missing knowledge, and citations. If the first excerpt exceeds the budget, return an empty excerpt list and `insufficient` rather than truncating a citation-bearing fact mid-record.

- [x] **Step 6: Implement task context and lineage/provenance delegation**

Extract Issue/MR identifiers from the task string for ranking only; do not call GitLab. Delegate direct operations to the repository and preserve safe not-found behavior.

- [x] **Step 7: Run engine tests and quality checks**

Run: `npm test -- tests/engine/context-engine.test.ts && npm run typecheck && npm run format:check`

Expected: PASS.

### Task 5: Register MCP tools and resources over stdio

**Files:**
- Create: `src/mcp/tools.ts`
- Create: `src/mcp/resources.ts`
- Create: `src/mcp/adapter.ts`
- Modify: `src/server.ts`
- Create: `tests/mcp/stdio-contract.test.ts`

**Interfaces:**
- Consumes: `ContextEngine` from Task 4 and official MCP SDK.
- Produces: `createMcpServer(engine): McpServer`, seven tool registrations, three resource registrations, and a stdio entry point.

- [x] **Step 1: Write the MCP contract test**

Spawn the compiled server with `node dist/server.js --stdio`, initialize an MCP client using `StdioClientTransport`, list tools/resources, call `search_knowledge` with the public seed query, and assert the result has `results`, `appliedFilters`, `evidenceStatus`, and a citation. Call the same tool with an invalid limit and assert a structured invalid-input error.

- [x] **Step 2: Run the contract test and confirm it fails**

Run: `npm run build && npm test -- tests/mcp/stdio-contract.test.ts`

Expected: FAIL because no MCP adapter or stdio process exists.

- [x] **Step 3: Implement adapter registration**

Use `McpServer` and `StdioServerTransport` from the pinned SDK. Register each tool with its Zod input schema and a JSON-compatible output shape. Convert `KcpError` to safe MCP errors. Register resources for artifact, exact artifact revision, and taxonomy URIs; resolve authorization through the engine, never directly through the seed repository.

- [x] **Step 4: Implement the stdio entry point**

Make `src/server.ts` create configuration, seed repository, audit sink, engine, MCP server, and `StdioServerTransport` when `--stdio` is present. Keep stdout exclusively for MCP protocol messages; send operational logs to stderr.

- [x] **Step 5: Run the MCP contract test and inspect tool/resource lists**

Run: `npm run build && npm test -- tests/mcp/stdio-contract.test.ts`

Expected: PASS; seven tools and three resource templates are listed, and valid results contain citations.

### Task 6: Add operational health checks and application wiring

**Files:**
- Create: `src/ops/health-server.ts`
- Modify: `src/server.ts`
- Create: `tests/ops/health-server.test.ts`

**Interfaces:**
- Consumes: `AppConfig` and initialized repository/engine from Tasks 1 and 4.
- Produces: `createHealthServer({ host, port, isReady }): Promise<HealthServer>` with `close(): Promise<void>` and JSON `/health` and `/ready` responses.

- [x] **Step 1: Write health/readiness tests**

Test that `/health` returns HTTP 200 and `{ status: "ok" }`; test that `/ready` returns HTTP 503 with `{ status: "not_ready" }` before initialization and HTTP 200 with `{ status: "ready" }` after initialization.

- [x] **Step 2: Run the focused tests and confirm they fail**

Run: `npm test -- tests/ops/health-server.test.ts`

Expected: FAIL because the health server does not exist.

- [x] **Step 3: Implement the Fastify health server**

Bind only to configured local host/port in I1. Expose exactly `/health` and `/ready`; do not expose MCP messages or catalog content over this listener. Close the Fastify instance during tests and process shutdown.

- [x] **Step 4: Wire startup and shutdown**

Start the health server and stdio MCP server from the same composition root. Set readiness only after seed repository and engine creation succeeds. Handle `SIGINT` and `SIGTERM` by closing the health server and exiting without logging secrets or request content.

- [x] **Step 5: Run health, contract, and full tests**

Run: `npm test && npm run typecheck && npm run format:check`

Expected: PASS.

### Task 7: Add CI and developer documentation

**Files:**
- Create: `.gitlab-ci.yml`
- Create: `README.md`
- Create: `docs/operations/i1-local-development.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: runnable server and scripts from Tasks 1–6.
- Produces: reproducible local setup, CI quality gate, and usage documentation for stdio and health checks.

- [x] **Step 1: Write the documented command checklist**

Document the exact sequence `npm ci`, `npm run build`, `npm test`, `npm run typecheck`, `npm run format:check`, and `npm run dev -- --stdio`. Document that MCP protocol output is on stdout and operational diagnostics are on stderr.

- [x] **Step 2: Add CI jobs**

Configure `.gitlab-ci.yml` with a Node 22 image, `npm ci`, and separate `test`, `typecheck`, `format`, and `build` jobs. Cache npm data using the lockfile and fail the pipeline on any command failure.

- [x] **Step 3: Add a smoke script**

Add `npm run smoke` to build the server, start the stdio process, initialize a client, list the seven tools, and exit nonzero if initialization or discovery fails. Keep the smoke path deterministic and offline.

- [x] **Step 4: Run the complete local gate**

Run: `npm ci && npm run format:check && npm run typecheck && npm test && npm run build && npm run smoke`

Expected: all commands PASS without external services or credentials.

## Final Verification

- [x] Confirm `npm run smoke` discovers seven tools and three resource templates.
- [x] Confirm unauthorized seed artifacts produce no metadata through search or direct resources.
- [x] Confirm no test fixture or log contains a JWT, secret, raw prompt, or full source document.
- [x] Confirm `/health` and `/ready` are not part of the MCP public tool/resource list.
- [x] Confirm the public contracts match the approved design and both PRD files.
- [x] Report any intentionally deferred I2/I3 behavior explicitly; do not claim hybrid retrieval, Keycloak, Vault, MySQL, Qdrant, or HTTP MCP support in I1.
