# Task 6: Add operational health checks and application wiring

## Files

- Create `src/ops/health-server.ts` and `tests/ops/health-server.test.ts`.
- Modify `src/server.ts` to start/close MCP and health services.

## Required interfaces

- Export `createHealthServer({ host, port, isReady }): Promise<HealthServer>`.
- `HealthServer` exports `close(): Promise<void>`.
- `GET /health` returns HTTP 200 and `{ status: "ok" }`.
- `GET /ready` returns HTTP 503 and `{ status: "not_ready" }` before initialization; return HTTP 200 and `{ status: "ready" }` after initialization.
- Bind only to configured local host/port in I1; expose exactly `/health` and `/ready`.
- Start health and stdio MCP from one composition root; readiness becomes true only after repository/engine initialization.
- Handle SIGINT/SIGTERM by closing health server without logging secrets/request content.

## Validation

Run `npm test -- tests/ops/health-server.test.ts`, `npm run typecheck`, and `npm run format:check`. Write exact evidence to `.superpowers/sdd/2026-08-29-knowledge-context-mcp-i1/task-6-report.md`.

## Constraints

- Do not dispatch subagents or commit.
- Do not implement Streamable HTTP, external services, or new MCP tools.
- Preserve Tasks 1–5 and unrelated files.
