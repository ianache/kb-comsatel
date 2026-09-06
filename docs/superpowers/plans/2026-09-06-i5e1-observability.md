# I5-E1 Observabilidad Base Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exponer métricas Prometheus, logs estructurados con correlation ID y una integración OpenTelemetry opcional sin cambiar el contrato MCP ni filtrar datos sensibles.

**Architecture:** Crear un módulo de observabilidad independiente con un registry bounded de métricas, logger sanitizado y contexto por operación. El servidor operativo expondrá `/metrics`; el adapter MCP envolverá handlers para medir operaciones tanto en STDIO como en HTTP. OpenTelemetry será un exporter opcional fail-open, deshabilitado por defecto.

**Tech Stack:** TypeScript, Node.js 22, Fastify 5, Vitest, Pino existente, `@opentelemetry/api` y `@opentelemetry/sdk-node` solo para el camino OTEL opcional.

**Spec:** `docs/superpowers/specs/2026-09-06-i5e1-observability-design.md`

## Global Constraints

- Mantener sin cambios los nombres, argumentos y resultados de las siete herramientas MCP.
- Mantener los tres resource templates y el contrato STDIO.
- STDIO reserva stdout al protocolo; los logs deben ir a stderr.
- `KCP_OTEL_ENABLED=false` por defecto; OTEL deshabilitado no realiza llamadas externas.
- No usar como etiquetas Prometheus `userId`, `group`, `query`, `knowledgeId`, URI, JWT, correlation ID ni texto libre.
- Nunca registrar `Authorization`, cookies, tokens, JWT, contraseñas, payloads, extractos o contenido documental.
- `/health` y `/ready` conservan sus respuestas actuales.
- Preservar el cambio de usuario existente en `docs/manual-tests/10-i5b-gitlab-source-indexing.md`.

---

### Task 1: Contratos de observabilidad y configuración

**Files:**
- Create: `src/ops/observability-types.ts`
- Create: `src/ops/metrics-registry.ts`
- Create: `src/ops/structured-logger.ts`
- Modify: `src/config.ts`
- Modify: `.env.example`
- Test: `tests/ops/metrics-registry.test.ts`
- Test: `tests/ops/structured-logger.test.ts`
- Test: `tests/config.test.ts`

**Interfaces:**
- `MetricsRegistry.increment(name, labels, value?): void`
- `MetricsRegistry.observe(name, labels, value): void`
- `MetricsRegistry.set(name, labels, value): void`
- `MetricsRegistry.renderPrometheus(): string`
- `createMetricsRegistry(): MetricsRegistry`
- `createStructuredLogger(options): StructuredLogger`
- `StructuredLogger.info(event)`, `warn(event)`, `error(event)`; output only sanitized `SafeLogEvent`.
- `ObservabilityOptions`: `otelEnabled`, `otelEndpoint?`, `otelServiceName`, `otelEnvironment`.

- [ ] **Step 1: Write failing registry tests**

  Add tests that increment `kcp_mcp_requests_total`, observe `kcp_mcp_request_duration_ms`, render `# TYPE` and sample lines, reject unknown metric names, and prove query/correlation ID values never become labels.

- [ ] **Step 2: Run registry tests to verify failure**

  Run: `npm test -- tests/ops/metrics-registry.test.ts`

  Expected: FAIL because the registry module does not exist.

- [ ] **Step 3: Implement bounded registry**

  Define the eight metric names from the spec as an internal allowlist. Normalize label values to enums and render valid Prometheus text with stable HELP/TYPE headers. Unknown names or labels must throw a safe programmer/configuration error rather than create unbounded series.

- [ ] **Step 4: Write failing logger tests**

  Assert that a log event retains `operation`, `transport`, `outcome`, `durationMs`, and a safe correlation ID while removing authorization headers, tokens, JWTs, query text, excerpts, and control characters.

- [ ] **Step 5: Implement structured logger**

  Use the existing Pino dependency with a destination abstraction that defaults to stderr. Sanitize values before serialization and emit one JSON object per event. Never call `console.log` from the logger.

- [ ] **Step 6: Add configuration tests and parsing**

  Add defaults for `KCP_OTEL_ENABLED`, `KCP_OTEL_ENDPOINT`, `KCP_OTEL_SERVICE_NAME`, and `KCP_OTEL_ENVIRONMENT`; reject invalid booleans/URLs/names with safe messages. Keep OTEL disabled unless explicitly true.

- [ ] **Step 7: Verify and commit**

  Run: `npm test -- tests/ops/metrics-registry.test.ts tests/ops/structured-logger.test.ts tests/config.test.ts && npm run typecheck`

  Commit: `feat: add bounded observability contracts`

### Task 2: Expose `/metrics` through the operational server

**Files:**
- Modify: `src/ops/health-server.ts`
- Modify: `src/server.ts`
- Modify: `src/ops/runtime-dependencies.ts`
- Test: `tests/ops/health-server.test.ts`
- Test: `tests/ops/metrics-endpoint.test.ts`

**Interfaces:**
- Extend `CreateHealthServerOptions` with `metrics: MetricsRegistry` and `logger: StructuredLogger`.
- Preserve `HealthServer.close(): Promise<void>`.
- `GET /metrics` returns `text/plain; version=0.0.4; charset=utf-8`.

- [ ] **Step 1: Write failing endpoint tests**

  Add tests proving `/health` and `/ready` remain unchanged, `/metrics` returns Prometheus text after a seeded counter, unsupported methods remain rejected, and metrics output contains no sensitive strings.

- [ ] **Step 2: Run endpoint tests to verify failure**

  Run: `npm test -- tests/ops/health-server.test.ts tests/ops/metrics-endpoint.test.ts`

  Expected: FAIL because `/metrics` and its dependency injection do not exist.

- [ ] **Step 3: Wire registry into health server**

  Register `GET /metrics` without adding it to MCP. Keep the current loopback host guard and existing readiness behavior.

- [ ] **Step 4: Wire one registry/logger per application**

  Instantiate observability after config load, inject it into the health server and application lifecycle, and close any OTEL provider during `Application.close()`.

- [ ] **Step 5: Verify and commit**

  Run: `npm test -- tests/ops/health-server.test.ts tests/ops/metrics-endpoint.test.ts tests/config.test.ts && npm run typecheck`

  Commit: `feat: expose Prometheus metrics endpoint`

### Task 3: Correlation and MCP operation instrumentation

**Files:**
- Create: `src/ops/observability-context.ts`
- Modify: `src/mcp/tools.ts`
- Modify: `src/mcp/adapter.ts`
- Modify: `src/mcp/http-server.ts`
- Modify: `src/server.ts`
- Test: `tests/mcp/observability-contract.test.ts`
- Test: `tests/mcp/stdio-contract.test.ts`
- Test: `tests/mcp/http-contract.test.ts`

**Interfaces:**
- `createObservabilityContext(options): ObservabilityContext`
- `ObservabilityContext.startOperation(input): OperationScope`
- `OperationScope.success(fields?)`, `failure(errorCode)`, `close()`
- `createMcpServer(engine, principal?, observability?): McpServer`
- `createHttpMcpServer(options)` receives the same optional observability object.

- [ ] **Step 1: Write failing MCP observability tests**

  Exercise `search_knowledge` through STDIO and HTTP, then assert request and duration metrics are incremented, outcome/error metrics are separated, and the HTTP allowlisted correlation header is preserved only in the log event—not in metric labels or response bodies.

- [ ] **Step 2: Run focused tests to verify failure**

  Run: `npm test -- tests/mcp/observability-contract.test.ts tests/mcp/stdio-contract.test.ts tests/mcp/http-contract.test.ts`

  Expected: the existing MCP contract tests may pass, but the new observability assertions fail because no operation instrumentation exists.

- [ ] **Step 3: Implement safe correlation extraction**

  Accept one allowlisted correlation header, validate length and control characters, and generate a UUID for absent/invalid values. Use transport labels `stdio` or `http` and fixed operation names.

- [ ] **Step 4: Wrap tool handlers**

  Instrument the registered tool handlers at the adapter boundary. Record success/failure, duration, and safe error code. Do not alter tool result schemas or add observability fields to MCP responses.

- [ ] **Step 5: Instrument HTTP requests**

  Start an operation around principal resolution and MCP request handling. Ensure errors are converted by the existing HTTP error path and metrics/logging execute in `finally` without preventing cleanup.

- [ ] **Step 6: Instrument STDIO safely**

  Pass the optional context through `createStdioApplication` and `createMcpServer`. Keep diagnostics on stderr and assert stdout remains valid JSON-RPC in existing tests.

- [ ] **Step 7: Verify and commit**

  Run: `npm test -- tests/mcp/observability-contract.test.ts tests/mcp/stdio-contract.test.ts tests/mcp/http-contract.test.ts && npm run smoke`

  Commit: `feat: instrument MCP operations with correlation`

### Task 4: Optional OpenTelemetry provider

**Files:**
- Create: `src/ops/otel.ts`
- Modify: `src/ops/runtime-dependencies.ts`
- Modify: `src/server.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `tests/ops/otel.test.ts`
- Test: `tests/security/observability-sensitive-output.test.ts`

**Interfaces:**
- `createOtelProvider(config, logger): OtelProvider`
- `OtelProvider.shutdown(): Promise<void>`
- `OtelProvider.startSpan(name, attributes): SpanScope`

- [ ] **Step 1: Write failing OTEL tests**

  Verify disabled mode creates no exporter and no network call; enabled mode creates spans with bounded attributes; exporter initialization failure is logged safely and does not prevent application startup.

- [ ] **Step 2: Add the minimal OTEL dependencies**

  Add only the API/SDK packages needed for OTLP HTTP export. Keep versions pinned by the lockfile and do not initialize a global exporter when disabled.

- [ ] **Step 3: Implement fail-open provider**

  Map operation/dependency spans to the existing observability context, omit payloads and identifiers, and make shutdown idempotent. A failed exporter must produce one aggregate safe log event.

- [ ] **Step 4: Add sensitive-output tests**

  Feed logs, metrics and OTEL attributes with representative authorization headers, JWT-like values, tokens, URLs with credentials, query text, excerpts and document IDs. Assert none appear in serialized output.

- [ ] **Step 5: Verify and commit**

  Run: `npm test -- tests/ops/otel.test.ts tests/security/observability-sensitive-output.test.ts tests/security/no-sensitive-output.test.ts && npm run typecheck`

  Commit: `feat: add optional OpenTelemetry export`

### Task 5: Manual acceptance documentation and integrated verification

**Files:**
- Create: `docs/manual-tests/15-i5e1-observability.md`
- Modify: `docs/manual-tests/README.md`
- Modify: `.env.example`
- Test: `tests/ops/observability-acceptance.test.ts`

- [ ] **Step 1: Write the acceptance test**

  Start the local application on an ephemeral loopback port, call `/health`, `/ready`, `/metrics`, and one MCP operation, then assert metrics content type, counters, latency samples, correlation behavior and absence of sensitive output.

- [ ] **Step 2: Run the acceptance test to verify the complete flow**

  Run: `npm test -- tests/ops/observability-acceptance.test.ts`

  Expected: PASS after Tasks 1–4 are complete.

- [ ] **Step 3: Write the manual procedure**

  Document PowerShell commands for local mode, expected responses, `/metrics` inspection, correlation header verification, OTEL-disabled behavior, evidence capture and cleanup limited to `.tmp/i5e1-*`.

- [ ] **Step 4: Run the complete verification set**

  Run: `npm test -- tests/ops tests/mcp tests/security && npm run typecheck && npm run build && npm run smoke && git diff --check`

  Expected: all focused tests pass, build/typecheck/smoke exit zero, and no sensitive-output assertion fails.

- [ ] **Step 5: Update Graphify and commit documentation**

  Run: `python -m graphify update .`

  Commit: `test: document I5-E1 observability acceptance`

## Plan self-review

- Spec coverage: FR-09/FR-12 map to Tasks 2–3; NFR-03 maps to Tasks 1, 3 and 4; NFR-05 maps to Tasks 1 and 3; NFR-08 maps to Tasks 1 and 4; manual acceptance maps to Task 5.
- No rate limiting, circuit breakers or OKE work is included; those remain I5-E2/I5-E3.
- Existing MCP schemas are unchanged; observability is injected as an optional dependency for backwards-compatible tests.
- All tasks have failing tests before implementation and a bounded verification command after implementation.
