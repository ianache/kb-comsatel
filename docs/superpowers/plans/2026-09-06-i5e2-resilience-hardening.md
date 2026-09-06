# I5-E2 Resilience and Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add SSRF-safe egress, bounded operation deadlines, circuit breakers, and per-identity HTTP admission controls while preserving existing MCP and adapter contracts.

**Architecture:** Add two reusable policy layers: `src/security/egress-policy.ts` validates every configured or dynamic outbound URL, and `src/ops/resilience.ts` provides deadlines and circuit breakers. The HTTP MCP server applies identity-keyed admission before creating a transport; outbound adapters use the same primitives and report safe operational metrics through the existing observability context.

**Tech Stack:** TypeScript, Zod, Fastify, Vitest, native `fetch`/`AbortController`, existing metrics registry and MCP Streamable HTTP transport.

**Spec:** `docs/superpowers/specs/2026-09-06-i5e2-resilience-hardening-design.md`

## Global Constraints

- The total MCP tool deadline defaults to 10 seconds and no dependency request may outlive the remaining deadline.
- Production outbound destinations require HTTPS, an explicit hostname allowlist, and a globally routable destination; private, loopback, link-local, multicast, metadata, and embedded-credential URLs are rejected.
- Rate limiting is local in-memory per process for I5-E2; distributed coordination belongs to I5-E3.
- Errors and metrics must not expose tokens, full document text, PII, or complete sensitive URLs.
- Existing injected fetchers remain available to tests and must use the same policy unless a test explicitly supplies a controlled policy bypass.
- Preserve the existing user modification in `docs/manual-tests/10-i5b-gitlab-source-indexing.md`; do not reset or include it in feature commits.

---

### Task 1: Extend configuration with safe resilience and egress settings

**Files:**
- Modify: `src/config.ts`
- Test: `tests/config-i5e2.test.ts`

**Interfaces:**
- Produces `AppConfig` fields for `operationTimeoutMs`, `rateLimitCapacity`, `rateLimitRefillPerSecond`, `maxConcurrentRequests`, `breakerFailureThreshold`, `breakerOpenMs`, `breakerHalfOpenMaxCalls`, and per-dependency allowlist strings.
- Produces `parseHostnameList(value: string | undefined): string[]` with trimmed, non-empty hostnames.

- [ ] **Step 1: Write failing configuration tests**

Cover defaults, positive-integer parsing, zero rejection, comma-separated hostname normalization, and the production rule that an enabled outbound dependency cannot use an empty allowlist. Assert the defaults include a 10,000 ms operation deadline and conservative nonzero admission limits.

```ts
it("loads conservative I5-E2 defaults", () => {
  const config = loadConfig({});
  expect(config.operationTimeoutMs).toBe(10_000);
  expect(config.rateLimitCapacity).toBeGreaterThan(0);
  expect(config.maxConcurrentRequests).toBeGreaterThan(0);
});

it("rejects malformed resilience settings", () => {
  expect(() => loadConfig({ KCP_OPERATION_TIMEOUT_MS: "0" })).toThrow(
    "Invalid KCP_OPERATION_TIMEOUT_MS",
  );
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npm test -- --run tests/config-i5e2.test.ts`

Expected: FAIL because the new configuration fields and parsing do not exist.

- [ ] **Step 3: Implement the configuration fields and parsers**

Add Zod fields and environment mappings without changing existing defaults. Use explicit variables such as `KCP_EGRESS_GITLAB_ALLOWED_HOSTS`, `KCP_EGRESS_GITLAB_SOURCE_ALLOWED_HOSTS`, `KCP_EGRESS_DRIVE_ALLOWED_HOSTS`, `KCP_EGRESS_EMBEDDING_ALLOWED_HOSTS`, `KCP_EGRESS_QDRANT_ALLOWED_HOSTS`, and `KCP_EGRESS_OIDC_ALLOWED_HOSTS`. Keep allowlists as arrays in `AppConfig`; do not log them during startup.

- [ ] **Step 4: Run configuration tests and the existing config regression suite**

Run: `npm test -- --run tests/config-i5e2.test.ts tests/config.test.ts tests/config-i2.test.ts tests/config-i3.test.ts tests/config-i5c.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the configuration slice**

```bash
git add src/config.ts tests/config-i5e2.test.ts
git commit -m "feat: configure I5-E2 resilience policies"
```

### Task 2: Implement SSRF-safe egress policy

**Files:**
- Create: `src/security/egress-policy.ts`
- Test: `tests/security/egress-policy.test.ts`

**Interfaces:**
- `type EgressDependency = "gitlab" | "gitlab-source" | "drive" | "embedding" | "qdrant" | "oidc"`
- `interface EgressPolicy { validate(url: string | URL, dependency: EgressDependency): URL; validateRedirect(url: string | URL, dependency: EgressDependency): URL }`
- `createEgressPolicy(options: { allowedHosts: Record<EgressDependency, string[]>; allowHttp: boolean; dnsLookup?: (hostname: string) => Promise<string[]> }): EgressPolicy`
- `EgressDeniedError` exposes only `dependency`, `reason`, and sanitized `hostname`.

- [ ] **Step 1: Write failing SSRF tests**

Test rejection of `127.0.0.1`, `::1`, RFC1918 IPv4, IPv6 unique-local/link-local, `169.254.169.254`, multicast, credentials in the URL, non-HTTPS production URLs, non-allowlisted hosts, and ports outside 443. Test an allowlisted public HTTPS URL and an explicitly enabled development HTTP URL. Test redirect validation independently.

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `npm test -- --run tests/security/egress-policy.test.ts`

Expected: FAIL because the policy module does not exist.

- [ ] **Step 3: Implement hostname, IP, port, scheme, and allowlist checks**

Normalize the hostname case, reject username/password, reject unsupported schemes, compare exact hostnames or safe subdomain entries, and perform DNS checks through the injectable resolver. Never follow a redirect without revalidating it.

```ts
export class EgressDeniedError extends Error {
  readonly code = "EGRESS_DENIED" as const;
  constructor(
    readonly dependency: EgressDependency,
    readonly reason: string,
    readonly hostname: string,
  ) {
    super(`Outbound request denied for ${dependency}: ${reason}`);
  }
}
```

- [ ] **Step 4: Run SSRF tests and security-sensitive-output tests**

Run: `npm test -- --run tests/security/egress-policy.test.ts tests/security/observability-sensitive-output.test.ts`

Expected: PASS; no token, path, query, or full URL appears in an error or metric label.

- [ ] **Step 5: Commit the egress policy slice**

```bash
git add src/security/egress-policy.ts tests/security/egress-policy.test.ts
git commit -m "feat: enforce SSRF-safe outbound egress"
```

### Task 3: Implement deadline and circuit-breaker primitives

**Files:**
- Create: `src/ops/resilience.ts`
- Test: `tests/ops/resilience.test.ts`

**Interfaces:**
- `interface OperationDeadline { readonly expiresAt: number; remainingMs(): number; signal(): AbortSignal; child(): OperationDeadline }`
- `createOperationDeadline(timeoutMs: number, now?: () => number): OperationDeadline`
- `interface CircuitBreaker { execute<T>(operation: () => Promise<T>): Promise<T>; state(): "closed" | "open" | "half-open"; reset(): void }`
- `createCircuitBreaker(options: { failureThreshold: number; openMs: number; halfOpenMaxCalls: number; now?: () => number }): CircuitBreaker`
- `ResilienceError` codes: `OPERATION_TIMEOUT`, `CIRCUIT_OPEN`, `DEPENDENCY_UNAVAILABLE`.

- [ ] **Step 1: Write failing deadline and breaker tests**

Use fake timers or an injected clock. Verify child deadlines cannot exceed the parent, an expired deadline aborts, transient failures open after the configured threshold, open breakers fail fast, and a successful half-open probe closes the breaker. Verify 4xx/domain errors can be excluded by the caller and do not count as transport failures.

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `npm test -- --run tests/ops/resilience.test.ts`

Expected: FAIL because the resilience module does not exist.

- [ ] **Step 3: Implement the primitives**

Ensure every timer is cleared in `finally`; never create an unbounded retry loop; cap half-open probes; and classify only timeout/network/5xx failures as breaker failures. The operation wrapper must pass the remaining deadline to the callback.

- [ ] **Step 4: Run resilience tests**

Run: `npm test -- --run tests/ops/resilience.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the primitives**

```bash
git add src/ops/resilience.ts tests/ops/resilience.test.ts
git commit -m "feat: add operation deadlines and circuit breakers"
```

### Task 4: Apply egress and resilience to outbound adapters

**Files:**
- Modify: `src/ingestion/gitlab-http-source-adapter.ts`
- Modify: `src/ingestion/google-drive-http-adapter.ts`
- Modify: `src/publication/gitlab-http-adapter.ts`
- Modify: `src/retrieval/http-embedding-provider.ts`
- Modify: `src/security/oidc-discovery.ts`
- Modify: `src/server.ts`
- Test: existing adapter tests plus `tests/integration/i5e2-egress-adapters.test.ts`

**Interfaces:**
- Extend adapter options with `egressPolicy?: EgressPolicy`, `breaker?: CircuitBreaker`, and `deadline?: OperationDeadline` while preserving existing constructors and injected fetchers.
- `server.ts` creates one policy and one breaker per logical dependency and passes them into enabled adapters.

- [ ] **Step 1: Add failing adapter integration tests**

Verify each adapter rejects a disallowed URL before its fetcher is called, times out within the remaining deadline, maps an open breaker to the existing unavailable-safe result, and revalidates redirects. Preserve current auth/not-found mappings.

- [ ] **Step 2: Run adapter tests and verify failure**

Run: `npm test -- --run tests/ingestion/gitlab-http-source-adapter.test.ts tests/ingestion/google-drive-adapter.test.ts tests/publication/gitlab-http-adapter.test.ts tests/retrieval/http-embedding-provider.test.ts tests/security/oidc-discovery.test.ts tests/integration/i5e2-egress-adapters.test.ts`

Expected: the new egress/deadline cases fail while existing behavior remains green.

- [ ] **Step 3: Thread policy and deadline through every outbound request**

Validate the final request URL immediately before `fetch`, use a child deadline for each dependency call, pass its abort signal, and route transport failures through the dependency breaker. Keep headers unchanged functionally, but never include them in errors/logs.

- [ ] **Step 4: Wire configured policies and breakers in `server.ts`**

Construct dependencies only when enabled, use the six configured allowlists, and ensure default-disabled integrations do not require tokens or external connectivity. Keep health/readiness startup behavior unchanged.

- [ ] **Step 5: Run adapter and integration tests**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 6: Commit the outbound hardening slice**

```bash
git add src/ingestion src/publication src/retrieval src/security/oidc-discovery.ts src/server.ts tests/integration/i5e2-egress-adapters.test.ts
git commit -m "feat: harden outbound adapters with egress and breakers"
```

### Task 5: Add HTTP rate limiting and concurrency admission

**Files:**
- Create: `src/mcp/admission-control.ts`
- Modify: `src/mcp/http-server.ts`
- Test: `tests/mcp/admission-control.test.ts`
- Test: `tests/mcp/http-resilience-contract.test.ts`

**Interfaces:**
- `interface AdmissionControl { admit(identity: string): AdmissionLease | AdmissionRejection; release(identity: string): void }`
- `AdmissionLease` contains `release(): void` and `retryAfterSeconds?: number`.
- `AdmissionRejection` contains `statusCode: 429 | 503`, `retryAfterSeconds: number`, and a safe `reason`.
- `createAdmissionControl(options: { capacity: number; refillPerSecond: number; maxConcurrent: number; now?: () => number }): AdmissionControl`

- [ ] **Step 1: Write failing admission tests**

Verify separate identities do not share buckets, anonymous requests use a single bounded key, capacity/refill works, concurrent leases cannot exceed the limit, release is idempotent, and rejected requests return a bounded `Retry-After`.

- [ ] **Step 2: Run focused admission tests and verify failure**

Run: `npm test -- --run tests/mcp/admission-control.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement bounded local admission control**

Use a `Map<string, BucketState>` with lazy refill and explicit cleanup of stale identities. Do not key by raw bearer tokens; use the authenticated principal identity or a fixed anonymous key.

- [ ] **Step 4: Add HTTP contract tests**

Use `fastify.inject` against `createHttpMcpServer`. Assert admission occurs after authentication and before `createMcpServer`/transport creation, `429` includes `Retry-After`, concurrency saturation returns `503`, and normal MCP requests preserve existing responses.

- [ ] **Step 5: Integrate admission in `http-server.ts`**

Add optional `admissionControl` to `HttpMcpServerOptions`. Resolve the principal first, derive a sanitized stable identity, acquire a lease, and release it in `finally`, including error and transport-close paths. Keep GET `/mcp` as `405`.

- [ ] **Step 6: Run HTTP tests**

Run: `npm test -- --run tests/mcp/admission-control.test.ts tests/mcp/http-resilience-contract.test.ts tests/mcp/http-contract.test.ts tests/mcp/http-auth.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit HTTP admission control**

```bash
git add src/mcp/admission-control.ts src/mcp/http-server.ts tests/mcp/admission-control.test.ts tests/mcp/http-resilience-contract.test.ts
git commit -m "feat: add per-identity HTTP admission control"
```

### Task 6: Add operational metrics, safe error mapping, and configuration wiring

**Files:**
- Modify: `src/ops/metrics-registry.ts`
- Modify: `src/mcp/http-server.ts`
- Modify: `src/server.ts`
- Modify: `src/mcp/http-errors.ts`
- Test: `tests/ops/i5e2-metrics.test.ts`
- Test: `tests/mcp/http-resilience-contract.test.ts`

**Interfaces:**
- New metric names: `kcp_resilience_events_total` labels `dependency`, `event`; `kcp_http_admission_total` labels `outcome`, `reason`; `kcp_http_inflight` labels `identity_class`.
- `httpErrorResponse` maps admission rejection to `429`/`503`, deadline to `504`, egress denial to `403`, and breaker open/dependency unavailable to `503`.

- [ ] **Step 1: Write failing metric and mapping tests**

Assert Prometheus output includes only bounded labels and the expected types; assert all new operational errors map to safe status/code/message combinations without URLs, headers, tokens, or payloads.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- --run tests/ops/i5e2-metrics.test.ts tests/mcp/http-resilience-contract.test.ts`

Expected: FAIL for missing metrics and mappings.

- [ ] **Step 3: Implement metrics and error mappings**

Increment metrics at admission, egress, timeout, breaker open, and recovery transitions. Use dependency names and fixed reason enums only. Wire configured admission and operation deadline into `server.ts` for HTTP requests; STDIO receives the same deadline at tool-wrapper level.

- [ ] **Step 4: Run focused and sensitive-output tests**

Run: `npm test -- --run tests/ops/i5e2-metrics.test.ts tests/mcp/http-resilience-contract.test.ts tests/security/observability-sensitive-output.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit operational wiring**

```bash
git add src/ops/metrics-registry.ts src/mcp/http-server.ts src/mcp/http-errors.ts src/server.ts tests/ops/i5e2-metrics.test.ts tests/mcp/http-resilience-contract.test.ts
git commit -m "feat: expose resilience metrics and safe errors"
```

### Task 7: Add manual test guide and complete verification

**Files:**
- Create: `docs/manual-tests/16-i5e2-resilience-security.md`
- Modify: `.env.example` or the project’s existing environment documentation, if present

**Interfaces:**
- Manual guide documents exact PowerShell commands, expected HTTP statuses, expected metric names, and cleanup steps without including real tokens.

- [ ] **Step 1: Write the manual test guide**

Document six cases: allowed GitLab request; SSRF rejection against loopback/private metadata; rate limit `429`; concurrency `503`; dependency timeout `504`; breaker open/recovery with `/metrics`. Include fixture-safe environment variables and a note that allowlists must contain the demo GitLab hostname, not a token or repository path.

- [ ] **Step 2: Run the full automated verification**

Run:

```powershell
npm test
npm run typecheck
npm run build
npm run smoke
git diff --check
```

Expected: all tests pass, typecheck/build succeed, smoke reports 7 tools and 3 resource templates, and `git diff --check` produces no output.

- [ ] **Step 3: Review the diff and protected user changes**

Run: `git status --short; git diff main...HEAD --stat; git diff --check main...HEAD`

Confirm the feature branch contains only I5-E2 commits and the main worktree’s pre-existing I5-B manual-test modification remains outside this branch.

- [ ] **Step 4: Commit the manual guide and final documentation**

```bash
git add docs/manual-tests/16-i5e2-resilience-security.md .env.example
git commit -m "docs: add I5-E2 resilience manual tests"
```

## Self-review coverage

- SSRF/allowlist and redirect validation: Tasks 1–2 and 4.
- Deadline and 10-second tool limit: Tasks 1, 3, 4, and 6.
- Circuit breaker and recovery: Tasks 3–4 and 6.
- Per-identity rate limiting and concurrency: Tasks 1, 5, and 6.
- Safe logs/metrics and stable errors: Tasks 2, 4, and 6.
- Manual and automated verification: Task 7.
- Out-of-scope distributed limiting, OKE/HPA, Vault, and ACL redesign remain explicitly outside this plan.
