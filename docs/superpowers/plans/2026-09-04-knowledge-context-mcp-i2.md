# Knowledge Context MCP I2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add a persistent MySQL catalog, Keycloak/JWKS authentication and ACL authorization, persistent aggregate audit, and authenticated Streamable HTTP to the completed I1 MCP server without changing its seven tools or three resource templates.

**Architecture:** Keep `ContextEngine` as the policy boundary and inject infrastructure through small interfaces. Add `SqlExecutor`, `PrincipalResolver`, and `AuditSink` adapters; retain the in-memory implementations for offline stdio tests. Make MCP registration principal-aware so HTTP requests receive an authenticated `AccessPrincipal` while I1 stdio keeps its local principal.

**Tech Stack:** Node.js 22, TypeScript, official `@modelcontextprotocol/sdk` Streamable HTTP transport, `mysql2`, `jose`, Fastify 5, Zod 4, Vitest, SQL migrations, and optional Docker Compose integration services.

**Spec:** `docs/superpowers/specs/2026-09-04-knowledge-context-mcp-i2-design.md`

## Global Constraints

- Preserve the seven I1 tool names and three I1 resource URI templates exactly.
- Keep `ContextEngine` responsible for evidence, budget, citation, safe not-found, and response policy.
- Apply ACL filters in the repository before candidate retrieval and again before response serialization.
- HTTP authentication is mandatory unless `KCP_HTTP_LOCAL_MODE=true` is explicitly enabled for non-production local tests.
- Never accept credentials in query strings; never log or return JWTs, secrets, complete claims, SQL, prompts, or complete document text.
- HTTP audit events contain only `correlationId`, `principalId`, `operation`, `filterKeys`, `resultCount`, `authorization`, `evidenceStatus`, `latencyMs`, and timestamp.
- MySQL queries are parameterized, result sets are bounded, UTC timestamps are used, and the pool closes during shutdown.
- Keycloak validation checks issuer, audience, signature, expiration, `nbf`, and accepted `azp`; JWKS refreshes on an unknown key ID.
- I1 stdio remains offline and uses the existing in-memory repository, local principal, and memory audit sink.
- I2 does not implement Qdrant, embeddings, hybrid retrieval, Vault runtime calls, Kubernetes deployment, portal ingestion, source connectors, mutation tools, or web UI.
- Every task ends with its focused test, typecheck where relevant, and a commit before the next task.

---

### Task 1: Add I2 dependencies, configuration, and infrastructure interfaces

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/config.ts`
- Create: `src/catalog/sql-executor.ts`
- Create: `src/security/principal-resolver.ts`
- Create: `src/ops/runtime-dependencies.ts`
- Create: `tests/config-i2.test.ts`
- Create: `tests/infrastructure-interfaces.test.ts`

**Interfaces:**
- Consumes: `AppConfig`, `AccessPrincipal`, `AuditSink`, and `KnowledgeRepository` from I1.
- Produces:
  - `SqlExecutor.query<T>(sql: string, params: readonly unknown[]): Promise<T[]>`;
  - `SqlExecutor.execute(sql: string, params: readonly unknown[]): Promise<void>`;
  - `SqlExecutor.ping(): Promise<void>` and `SqlExecutor.close(): Promise<void>`;
  - `PrincipalResolver.resolve(authorization: string | undefined): Promise<AccessPrincipal>`;
  - I2 `AppConfig` fields for MySQL, Keycloak, HTTP, request limits, and local mode.

- [x] **Step 1: Write failing configuration and interface tests**

```ts
import { expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

it("loads disabled HTTP and external adapters by default", () => {
  expect(loadConfig({})).toMatchObject({
    host: "127.0.0.1",
    port: 8787,
    httpEnabled: false,
    httpLocalMode: false,
    mysqlEnabled: false,
    keycloakEnabled: false,
  });
});

it("rejects HTTP without a configured issuer unless local mode is enabled", () => {
  expect(() =>
    loadConfig({ KCP_HTTP_ENABLED: "true", KCP_HTTP_LOCAL_MODE: "false" }),
  ).toThrow("Keycloak issuer is required");
});
```

Also assert that `SqlExecutor` and `PrincipalResolver` can be implemented by test fakes without importing a concrete database or Keycloak client.

- [x] **Step 2: Run focused tests and verify the expected failure**

Run: `npm test -- tests/config-i2.test.ts tests/infrastructure-interfaces.test.ts`

Expected: FAIL because the new configuration fields and interfaces do not exist.

- [x] **Step 3: Add dependencies and configuration parsing**

Add runtime dependencies `mysql2` and `jose`. Add these environment-backed configuration fields with the shown defaults and validation:

```ts
type AppConfig = {
  host: "127.0.0.1" | "::1";
  port: number;
  logLevel: "debug" | "info" | "warn" | "error";
  httpEnabled: boolean;
  httpLocalMode: boolean;
  httpPort: number;
  httpMaxBodyBytes: number;
  mysqlEnabled: boolean;
  mysqlUrl?: string;
  mysqlPoolSize: number;
  keycloakEnabled: boolean;
  keycloakIssuer?: string;
  keycloakAudience?: string;
  keycloakAzp: string[];
  keycloakClockToleranceSeconds: number;
  keycloakJwksCacheSeconds: number;
};
```

Use `KCP_HTTP_ENABLED=false`, `KCP_HTTP_LOCAL_MODE=false`, `KCP_HTTP_PORT=8790`, `KCP_HTTP_MAX_BODY_BYTES=1048576`, `KCP_MYSQL_ENABLED=false`, `KCP_MYSQL_POOL_SIZE=10`, `KCP_KEYCLOAK_ENABLED=false`, `KCP_KEYCLOAK_AZP=''`, `KCP_KEYCLOAK_CLOCK_TOLERANCE_SECONDS=5`, and `KCP_KEYCLOAK_JWKS_CACHE_SECONDS=300`. Require `KCP_MYSQL_URL` when MySQL is enabled and `KCP_KEYCLOAK_ISSUER` plus `KCP_KEYCLOAK_AUDIENCE` when Keycloak is enabled outside local mode.

- [x] **Step 4: Implement the small infrastructure interfaces**

Create `SqlExecutor` with no concrete SQL or connection logic, `PrincipalResolver` with the `resolve` signature above, and a runtime dependency bundle that groups repository, principal resolver, and audit sink without changing `ContextEngine`.

- [x] **Step 5: Run focused tests and checks**

Run: `npm test -- tests/config-i2.test.ts tests/infrastructure-interfaces.test.ts && npm run typecheck && npm run format:check`

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add package.json package-lock.json src/config.ts src/catalog/sql-executor.ts src/security/principal-resolver.ts src/ops/runtime-dependencies.ts tests/config-i2.test.ts tests/infrastructure-interfaces.test.ts
git commit -m "feat: add I2 infrastructure configuration boundaries"
```

### Task 2: Create MySQL schema, migrations, and pool adapter

**Files:**
- Create: `db/migrations/001_i2_catalog.sql`
- Create: `db/migrations/002_i2_indexes.sql`
- Create: `src/catalog/mysql-pool.ts`
- Create: `src/catalog/migrations.ts`
- Create: `tests/catalog/migrations.test.ts`
- Create: `tests/catalog/mysql-pool.test.ts`
- Create: `docker-compose.i2.yml`
- Create: `.env.i2.example`

**Interfaces:**
- Consumes: `SqlExecutor` and MySQL configuration from Task 1.
- Produces: `createMySqlPool(config): SqlExecutor`, `runMigrations(executor): Promise<void>`, and a schema that stores catalog, ACL, taxonomy, and aggregate audit data.

- [x] **Step 1: Write failing migration and pool tests**

```ts
import { expect, it } from "vitest";
import { migrationSql } from "../../src/catalog/migrations.js";

it("contains the required I2 tables and constraints", () => {
  const sql = migrationSql.join("\n");
  expect(sql).toContain("CREATE TABLE knowledge_artifacts");
  expect(sql).toContain("CREATE TABLE knowledge_revisions");
  expect(sql).toContain("CREATE TABLE knowledge_excerpts");
  expect(sql).toContain("CREATE TABLE knowledge_acl");
  expect(sql).toContain("CREATE TABLE knowledge_taxonomies");
  expect(sql).toContain("CREATE TABLE knowledge_audit_events");
  expect(sql).toMatch(/FOREIGN KEY.*knowledge_id/i);
});
```

Test that a disabled MySQL configuration does not open a connection, while an enabled configuration creates a bounded pool and `close()` delegates to the pool.

- [x] **Step 2: Run focused tests and verify the expected failure**

Run: `npm test -- tests/catalog/migrations.test.ts tests/catalog/mysql-pool.test.ts`

Expected: FAIL because migration definitions and the pool adapter do not exist.

- [x] **Step 3: Write the catalog migration**

Define `knowledge_artifacts` with `knowledge_id` primary key, title, artifact type, product, domain, classification, current status, source system, successor ID, and UTC timestamps. Define revisions with `(knowledge_id, source_revision)` uniqueness, source URI, content hash, locator fields, verification and stale timestamps. Define excerpts with a foreign key to the exact revision. Define ACL rows for artifact ID, principal ID, role, group, product, domain, and classification. Define taxonomies by `(product, domain)`. Define audit rows with the aggregate fields from the spec and indexes on principal, operation, and created time.

Use `InnoDB`, `utf8mb4`, `DATETIME(3)` in UTC, foreign keys, indexes for product/domain/status/source and ACL dimensions, and no column containing a JWT or full prompt.

- [x] **Step 4: Implement migrations and the bounded pool adapter**

`runMigrations` must execute migrations in lexical order and record applied filenames in a `schema_migrations` table. `createMySqlPool` must use `mysql2/promise`, `connectionLimit` from `mysqlPoolSize`, parameterized `execute`, a bounded `query`, `ping`, and idempotent `close`.

- [x] **Step 5: Add opt-in local integration services**

Create `docker-compose.i2.yml` with MySQL 8.4 only, a health check, a named volume, and environment variables read from `.env.i2.example`; do not add Keycloak credentials or production secrets. Keep integration tests skipped unless `KCP_I2_INTEGRATION=true`.

- [x] **Step 6: Run migration and pool checks**

Run: `npm test -- tests/catalog/migrations.test.ts tests/catalog/mysql-pool.test.ts && npm run typecheck && npm run format:check`

Expected: PASS without Docker or external services.

- [x] **Step 7: Commit**

```bash
git add db docker-compose.i2.yml .env.i2.example src/catalog/mysql-pool.ts src/catalog/migrations.ts tests/catalog/migrations.test.ts tests/catalog/mysql-pool.test.ts
git commit -m "feat: add I2 MySQL schema and pool adapter"
```

### Task 3: Implement the MySQL knowledge repository

**Files:**
- Create: `src/catalog/mysql-repository.ts`
- Create: `src/catalog/mysql-row-mappers.ts`
- Create: `tests/catalog/mysql-repository.test.ts`
- Modify: `src/catalog/repository.ts`
- Modify: `src/domain/errors.ts`

**Interfaces:**
- Consumes: `KnowledgeRepository`, `SqlExecutor`, schemas, and migrations from Tasks 1–2.
- Produces: `class MySqlKnowledgeRepository implements KnowledgeRepository` with the same seven repository methods as I1; unauthorized and missing direct reads return `null`.

- [x] **Step 1: Write failing repository behavior tests against a fake executor**

```ts
it("binds ACL and filter values before returning public results", async () => {
  const executor = new RecordingSqlExecutor(publicRows);
  const repository = new MySqlKnowledgeRepository(executor);
  const result = await repository.search(
    { query: "premium unit", limit: 8 },
    publicPrincipal,
  );
  expect(result.results[0]?.citation.knowledgeId).toBe("artifact-public-unit-rule");
  expect(executor.calls[0]?.params).toContain("cgo");
  expect(executor.calls[0]?.sql).not.toContain("premium unit");
});

it("returns null for an unauthorized exact artifact", async () => {
  const repository = new MySqlKnowledgeRepository(new RecordingSqlExecutor(restrictedRows));
  await expect(
    repository.getArtifact("artifact-restricted-adr", undefined, publicPrincipal),
  ).resolves.toBeNull();
});
```

Cover all repository methods, source revision matching, stale/status filters, taxonomy lookup, empty results, and conversion of database errors to `KcpError(INTERNAL_ERROR)`.

- [x] **Step 2: Run the focused repository tests and verify failure**

Run: `npm test -- tests/catalog/mysql-repository.test.ts`

Expected: FAIL because the MySQL repository and row mappers do not exist.

- [x] **Step 3: Define row types and safe mappers**

Create typed database row shapes for artifacts, revisions, excerpts, lineage, provenance, taxonomy, stale concepts, and ACL matches. Mappers must parse output with the existing Zod schemas and never copy ACL rows into public result objects.

- [x] **Step 4: Implement parameterized repository queries**

Use one query per repository operation with explicit selected columns. Build `WHERE` predicates from allow-listed filter fields and bind every value through `SqlExecutor.query`. ACL predicates must require matching principal, role, group, product/domain, or classification according to the existing `AccessPrincipal`; no query may concatenate user input. Enforce `limit <= 20` in code and SQL.

- [x] **Step 5: Implement safe error mapping**

Wrap executor failures in `KcpError` with `INTERNAL_ERROR` and message `Knowledge catalog unavailable`; preserve the original error only in a non-serialized cause field if the existing error type supports it. Return `null` for no rows and ACL-denied direct reads.

- [x] **Step 6: Run repository tests and checks**

Run: `npm test -- tests/catalog/mysql-repository.test.ts tests/catalog/memory-repository.test.ts && npm run typecheck && npm run format:check`

Expected: PASS; existing memory repository tests remain green.

- [x] **Step 7: Commit**

```bash
git add src/catalog/mysql-repository.ts src/catalog/mysql-row-mappers.ts src/catalog/repository.ts src/domain/errors.ts tests/catalog/mysql-repository.test.ts
git commit -m "feat: implement MySQL knowledge repository"
```

### Task 4: Implement Keycloak OIDC discovery, JWKS validation, and claim mapping

**Files:**
- Create: `src/security/keycloak-principal-resolver.ts`
- Create: `src/security/oidc-discovery.ts`
- Create: `src/security/security-errors.ts`
- Create: `tests/security/keycloak-principal-resolver.test.ts`
- Create: `tests/security/oidc-discovery.test.ts`

**Interfaces:**
- Consumes: `PrincipalResolver`, `AccessPrincipal`, and Keycloak configuration from Task 1.
- Produces: `KeycloakPrincipalResolver implements PrincipalResolver`, OIDC discovery cache, safe authentication errors, and deterministic claim mapping.

- [x] **Step 1: Write failing token-validation tests**

Test these cases with generated RSA keys and a fake discovery/JWKS fetcher: valid token, missing bearer header, malformed token, expired token, future `nbf`, wrong issuer, wrong audience, wrong `azp`, unknown key ID followed by JWKS refresh, and missing optional claims.

```ts
it("maps a valid Keycloak token to the existing AccessPrincipal contract", async () => {
  const resolver = createResolverWithFakeJwks(validKey);
  await expect(resolver.resolve(`Bearer ${validToken}`)).resolves.toEqual({
    id: "user-1",
    roles: ["developer"],
    groups: ["architecture-reviewers"],
    products: ["cgo"],
    domains: ["units"],
    classifications: ["internal"],
  });
});
```

- [x] **Step 2: Run focused tests and verify failure**

Run: `npm test -- tests/security/keycloak-principal-resolver.test.ts tests/security/oidc-discovery.test.ts`

Expected: FAIL because discovery, JWKS validation, and claim mapping do not exist.

- [x] **Step 3: Implement OIDC discovery and cache**

Fetch `${issuer}/.well-known/openid-configuration`, require an HTTPS URL except for loopback test URLs, validate `issuer` and `jwks_uri`, cache the result for `keycloakJwksCacheSeconds`, and refresh once when verification encounters an unknown `kid`. Deduplicate concurrent discovery requests.

- [x] **Step 4: Implement JWT verification**

Use `jose` `jwtVerify` with a remote JWK set, configured issuer, audience, clock tolerance, and `azp` check. Require a string `sub`. Map `realm_access.roles`, `resource_access[azp].roles`, and configured claim names into de-duplicated string arrays. Missing optional claims become empty arrays.

- [x] **Step 5: Implement safe authentication errors**

Return `KcpError` or a dedicated safe error with `UNAUTHORIZED` semantics and message `Authentication required` or `Invalid bearer token`; do not include verification details, claims, token fragments, or upstream response bodies.

- [x] **Step 6: Run security tests and checks**

Run: `npm test -- tests/security/keycloak-principal-resolver.test.ts tests/security/oidc-discovery.test.ts && npm run typecheck && npm run format:check`

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add src/security tests/security
git commit -m "feat: add Keycloak JWKS principal resolver"
```

### Task 5: Make MCP registration principal-aware without changing public contracts

**Files:**
- Modify: `src/mcp/tools.ts`
- Modify: `src/mcp/resources.ts`
- Modify: `src/mcp/adapter.ts`
- Create: `tests/mcp/principal-binding.test.ts`

**Interfaces:**
- Consumes: `ContextEngine`, `AccessPrincipal`, and `KeycloakPrincipalResolver` from Tasks 1 and 4.
- Produces:
  - `createMcpServer(engine: ContextEngine, principal?: AccessPrincipal): McpServer`;
  - `registerKnowledgeTools(engine, principal = localPrincipal)`;
  - `registerKnowledgeResources(engine, principal = localPrincipal)`.

- [x] **Step 1: Write failing principal-binding tests**

Create an engine spy or fake repository with a public and restricted artifact. Build one server with `publicPrincipal` and one with `restrictedPrincipal`; call the same tool/resource and assert that only the matching principal reaches the engine and that the tool/resource names and URI templates are unchanged.

- [x] **Step 2: Run the focused test and verify failure**

Run: `npm test -- tests/mcp/principal-binding.test.ts`

Expected: FAIL because tools and resources currently close over `localPrincipal`.

- [x] **Step 3: Thread the principal through registrations**

Replace direct `localPrincipal` references with the optional principal parameter while preserving the default for stdio. Do not change schemas, descriptions, tool names, resource names, or safe error serialization.

- [x] **Step 4: Run MCP contract and principal tests**

Run: `npm run build && npm test -- tests/mcp/principal-binding.test.ts tests/mcp/stdio-contract.test.ts`

Expected: PASS; seven tools and three resource templates remain unchanged.

- [x] **Step 5: Commit**

```bash
git add src/mcp/tools.ts src/mcp/resources.ts src/mcp/adapter.ts tests/mcp/principal-binding.test.ts
git commit -m "feat: bind MCP registrations to authenticated principals"
```

### Task 6: Add persistent audit sink and redaction tests

**Files:**
- Create: `src/engine/mysql-audit-sink.ts`
- Modify: `src/engine/audit.ts`
- Create: `tests/engine/mysql-audit-sink.test.ts`
- Modify: `tests/engine/context-engine.test.ts`

**Interfaces:**
- Consumes: `AuditSink`, `AuditEvent`, `SqlExecutor`, and audit schema from Tasks 1–2.
- Produces: `MySqlAuditSink implements AuditSink` with `record(event): Promise<void>` and idempotent `close(): Promise<void>` if it owns a client.

- [x] **Step 1: Write failing persistence and redaction tests**

```ts
it("persists only aggregate audit columns", async () => {
  const executor = new RecordingSqlExecutor();
  const sink = new MySqlAuditSink(executor);
  await sink.record({
    correlationId: "corr-1",
    principalId: "user-1",
    operation: "searchKnowledge",
    filterKeys: ["domain"],
    resultCount: 1,
    authorization: "authorized",
    evidenceStatus: "sufficient",
    latencyMs: 4,
  });
  expect(executor.calls[0]?.sql).not.toMatch(/prompt|token|secret|jwt|excerpt|content/i);
  expect(executor.calls[0]?.params).not.toContain("raw query text");
});
```

Also test that a database failure produces a safe `INTERNAL_ERROR` for the caller without changing the audit SQL payload shape.

- [x] **Step 2: Run focused tests and verify failure**

Run: `npm test -- tests/engine/mysql-audit-sink.test.ts`

Expected: FAIL because the persistent sink does not exist.

- [x] **Step 3: Implement the persistent sink**

Insert only the aggregate fields into `knowledge_audit_events` using a parameterized statement. Sort and copy `filterKeys`, validate finite latency and non-negative result count, and map insert failures to `KcpError(INTERNAL_ERROR)` without returning SQL or connection details.

- [x] **Step 4: Preserve the memory sink and verify engine wiring**

Keep `MemoryAuditSink` unchanged for offline tests. Add a test that `ContextEngine` records authorized, denied, and insufficient-evidence events with no query text or content fields.

- [x] **Step 5: Run tests and checks**

Run: `npm test -- tests/engine/mysql-audit-sink.test.ts tests/engine/context-engine.test.ts && npm run typecheck && npm run format:check`

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/engine/audit.ts src/engine/mysql-audit-sink.ts tests/engine/mysql-audit-sink.test.ts tests/engine/context-engine.test.ts
git commit -m "feat: persist aggregate audit events"
```

### Task 7: Implement authenticated Streamable HTTP transport

**Files:**
- Create: `src/mcp/http-server.ts`
- Create: `src/mcp/http-auth.ts`
- Create: `src/mcp/http-errors.ts`
- Modify: `src/ops/health-server.ts`
- Create: `tests/mcp/http-contract.test.ts`
- Create: `tests/mcp/http-auth.test.ts`
- Create: `tests/ops/http-readiness.test.ts`

**Interfaces:**
- Consumes: `ContextEngine`, principal-aware `createMcpServer`, `PrincipalResolver`, `AppConfig`, and official MCP SDK transport from Tasks 1, 4, and 5.
- Produces: `createHttpMcpServer(options): Promise<HttpServer>` with `start(): Promise<void>`, `close(): Promise<void>`, and `isReady(): boolean`.

- [x] **Step 1: Write failing HTTP/auth tests**

Test unauthenticated requests, invalid bearer tokens, local-mode requests, public tool calls, restricted tool calls, resource reads, unsupported methods, oversized bodies, open CORS rejection, correlation ID propagation, and `/health`/`/ready` readiness transitions.

```ts
it("serves the unchanged MCP discovery contract over authenticated HTTP", async () => {
  const response = await request.post("/mcp", {
    headers: { authorization: "Bearer valid-token" },
    body: initializeAndListToolsRequest,
  });
  expect(response.statusCode).toBe(200);
  expect(response.json().tools).toHaveLength(7);
});

it("rejects an HTTP request without bearer authentication", async () => {
  expect((await request.post("/mcp", { body: initializeRequest })).statusCode).toBe(401);
});
```

- [x] **Step 2: Run focused tests and verify failure**

Run: `npm test -- tests/mcp/http-contract.test.ts tests/mcp/http-auth.test.ts tests/ops/http-readiness.test.ts`

Expected: FAIL because the HTTP adapter and authenticated readiness path do not exist.

- [x] **Step 3: Implement authentication middleware and safe HTTP errors**

Extract only `Authorization: Bearer <token>`. Reject missing, duplicated, malformed, or query-string credentials with 401. Add a `x-correlation-id` if absent, validate its length/characters, and pass it to audit context without logging the token. Map authentication, authorization, validation, not-found, and infrastructure failures to safe status codes and JSON bodies.

- [x] **Step 4: Implement the SDK Streamable HTTP handler**

Use the installed SDK `StreamableHTTPServerTransport` export after verifying its exact versioned constructor in `node_modules`. For each authenticated MCP session, create or retrieve a principal-bound `McpServer`, connect the transport once, and dispatch POST/GET/DELETE according to the SDK transport contract. Set an explicit body limit, reject open CORS, and keep MCP payloads off stdout.

- [x] **Step 5: Implement HTTP server lifecycle and readiness**

Use Fastify for `/mcp`, `/health`, and `/ready` or a dedicated HTTP server wrapper. Readiness becomes true only after authentication metadata and enabled MySQL connectivity are initialized. `close()` must stop accepting requests, close MCP transports, and resolve cleanly when called more than once.

- [x] **Step 6: Run HTTP contract and operational tests**

Run: `npm run build && npm test -- tests/mcp/http-contract.test.ts tests/mcp/http-auth.test.ts tests/ops/http-readiness.test.ts tests/mcp/stdio-contract.test.ts`

Expected: PASS; HTTP and stdio expose the same seven tools and three resource templates.

- [x] **Step 7: Commit**

```bash
git add src/mcp/http-server.ts src/mcp/http-auth.ts src/mcp/http-errors.ts src/ops/health-server.ts tests/mcp/http-contract.test.ts tests/mcp/http-auth.test.ts tests/ops/http-readiness.test.ts
git commit -m "feat: add authenticated Streamable HTTP transport"
```

### Task 8: Wire I2 composition, MySQL mode, and local/integration smoke paths

**Files:**
- Modify: `src/ops/runtime-dependencies.ts`
- Modify: `src/server.ts`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/operations/i1-local-development.md`
- Create: `scripts/i2-integration-smoke.mjs`
- Create: `tests/server/i2-composition.test.ts`

**Interfaces:**
- Consumes: MySQL pool/repository, Keycloak resolver, persistent audit, HTTP server, and principal-aware MCP factory from Tasks 1–7.
- Produces: explicit runtime modes:
  - default: I1 offline stdio/local health behavior;
  - `KCP_MYSQL_ENABLED=true`: MySQL repository and persistent audit;
  - `KCP_HTTP_ENABLED=true`: authenticated Streamable HTTP;
  - `KCP_HTTP_LOCAL_MODE=true`: HTTP test mode with a deterministic local principal only when Keycloak is disabled.

- [x] **Step 1: Write failing composition tests**

Test that default startup uses memory adapters, MySQL mode constructs the SQL repository and persistent audit, HTTP mode rejects missing Keycloak configuration, local HTTP mode uses the local principal only with an explicit flag, readiness waits for enabled dependencies, and shutdown closes each dependency once.

- [x] **Step 2: Run focused composition tests and verify failure**

Run: `npm test -- tests/server/i2-composition.test.ts`

Expected: FAIL because the composition root still always creates seed memory adapters and has no HTTP mode.

- [x] **Step 3: Implement dependency selection and lifecycle**

Add a single `createRuntimeDependencies(config)` function. Keep all mode decisions there; `server.ts` should only start dependencies, create the engine, create stdio or HTTP transport, set readiness, and close them in reverse order. Do not change the default I1 mode.

- [x] **Step 4: Add scripts and documentation**

Add `i2:up`, `i2:migrate`, `i2:integration`, and `i2:smoke` scripts. Document required environment variables, offline mode, MySQL setup, Keycloak issuer/audience, bearer authentication, the `/mcp` endpoint, health/readiness, and the explicit non-goals for Qdrant/Vault/portal ingestion.

- [x] **Step 5: Add opt-in integration smoke**

`scripts/i2-integration-smoke.mjs` must exit with a clear skip message when `KCP_I2_INTEGRATION` is not `true`; when enabled, it must apply migrations, check readiness, initialize MCP over HTTP, discover seven tools and three templates, call a public query, and close the session. It must never print tokens or response bodies containing excerpts.

- [x] **Step 6: Run composition, local smoke, and checks**

Run: `npm test -- tests/server/i2-composition.test.ts && npm run format:check && npm run typecheck && npm run build && npm run smoke`

Expected: PASS without MySQL or Keycloak; I1 stdio smoke remains unchanged.

- [x] **Step 7: Commit**

```bash
git add src/ops/runtime-dependencies.ts src/server.ts package.json README.md docs/operations/i1-local-development.md scripts/i2-integration-smoke.mjs tests/server/i2-composition.test.ts
git commit -m "feat: wire I2 runtime modes and integration smoke"
```

### Task 9: Add CI gates and complete I2 verification

**Files:**
- Modify: `.gitlab-ci.yml`
- Create: `.gitlab-ci-i2.yml` if the existing pipeline cannot express opt-in integration cleanly
- Create: `tests/security/sensitive-output.test.ts`
- Create: `tests/integration/i2-mysql.test.ts`
- Create: `tests/integration/i2-http.test.ts`
- Modify: `docs/superpowers/plans/2026-09-04-knowledge-context-mcp-i2.md`

**Interfaces:**
- Consumes: all I2 components from Tasks 1–8.
- Produces: deterministic CI checks for offline quality and explicitly gated MySQL/Keycloak integration checks.

- [x] **Step 1: Write failing sensitive-output and integration harness tests**

Assert that serialized tool errors, resource errors, HTTP errors, audit rows, and logs do not contain `authorization`, `Bearer`, `jwt`, `secret`, `password`, raw prompts, SQL, full claims, or complete excerpt text. Define integration tests that skip unless `KCP_I2_INTEGRATION=true` and fail clearly when enabled services are unavailable.

- [x] **Step 2: Run focused tests and verify failure**

Run: `npm test -- tests/security/sensitive-output.test.ts tests/integration/i2-mysql.test.ts tests/integration/i2-http.test.ts`

Expected: FAIL because the sensitive-output suite and integration harness do not exist.

- [x] **Step 3: Implement CI stages and integration gating**

Keep offline `format`, `typecheck`, `test`, `build`, and stdio smoke jobs mandatory on Node 22. Add a manual or variable-gated I2 integration job that starts MySQL, requires explicit Keycloak test endpoint variables, runs migrations and integration tests, and never prints secrets.

- [x] **Step 4: Run the complete offline gate**

Run in this order so MCP contract tests have `dist/server.js`:

```bash
npm ci
npm run format:check
npm run typecheck
npm run build
npm test
npm run smoke
```

Expected: all offline checks pass, 31 or more tests pass including all new I2 tests, and smoke discovers seven tools and three resource templates.

- [x] **Step 5: Run opt-in integration gate when services are available**

Run: `KCP_I2_INTEGRATION=true npm run i2:integration`

Expected: migrations apply cleanly, readiness reaches ready, authenticated HTTP MCP discovery succeeds, public ACL tests pass, restricted artifacts remain undiscoverable, and shutdown closes all resources.

- [x] **Step 6: Mark the plan and report deferred scope**

Mark each completed checkbox only after its focused verification passes. Record explicitly that Qdrant/I3, Vault runtime integration, portal ingestion, Kubernetes deployment, and source connectors remain deferred.

- [x] **Step 7: Commit**

```bash
git add .gitlab-ci.yml .gitlab-ci-i2.yml tests/security/sensitive-output.test.ts tests/integration/i2-mysql.test.ts tests/integration/i2-http.test.ts docs/superpowers/plans/2026-09-04-knowledge-context-mcp-i2.md
git commit -m "test: add I2 security and integration gates"
```

## Final Verification Checklist

- [x] `npm run format:check` passes.
- [x] `npm run typecheck` passes.
- [x] `npm run build` passes.
- [x] `npm test` passes with all I1 and I2 offline tests.
- [x] `npm run smoke` discovers seven tools and three resource templates over stdio.
- [x] HTTP requests require bearer authentication outside explicit local mode.
- [x] MySQL repository applies ACL before retrieval and does not expose ACL rows.
- [x] JWT validation rejects issuer, audience, azp, signature, expiration, and `nbf` failures.
- [x] Audit persistence contains aggregate fields only.
- [x] HTTP and stdio public contracts are identical.
- [x] No test or log contains a secret, JWT, raw prompt, SQL, complete claims, or complete document text.
- [x] Deferred I3 and platform scope is documented explicitly.
