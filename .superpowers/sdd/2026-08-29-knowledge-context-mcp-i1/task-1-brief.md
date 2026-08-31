# Task 1: Scaffold the TypeScript service

## Files

- Create `package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.env.example`, `src/config.ts`, `src/server.ts`, and `tests/config.test.ts`.

## Required interfaces

- Export `loadConfig(env: Record<string, string | undefined>): AppConfig`.
- Export `createApplication(): Promise<Application>`.
- `AppConfig` has `host: string`, `port: number`, and `logLevel: "debug" | "info" | "warn" | "error"`.
- `Application` has `start(): Promise<void>` and `close(): Promise<void>`.
- Use Node.js 22 LTS, TypeScript 5.x, ESM, and NodeNext module resolution.
- Dependencies: `@modelcontextprotocol/sdk`, `fastify`, `zod`, `pino`; development dependencies: `typescript`, `tsx`, `vitest`, `prettier`, `@types/node`.
- Add scripts: `dev`, `build`, `start`, `typecheck`, `test`, `format`, and `format:check`.
- `loadConfig({})` returns `{ host: "127.0.0.1", port: 8787, logLevel: "info" }`.
- Parse `KCP_HOST`, `KCP_PORT`, and `KCP_LOG_LEVEL`; reject invalid ports instead of silently coercing them.
- Ignore `node_modules`, `dist`, `.env`, coverage, and local generated graph/output folders. Do not add credentials to `.env.example`.

## Required test

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

## Validation

Run `npm test -- tests/config.test.ts` and `npm run typecheck`. Report exact results in `.superpowers/sdd/2026-08-29-knowledge-context-mcp-i1/task-1-report.md`.

## Constraints

- Do not dispatch subagents.
- Do not create a Git commit; the controller is operating under a no-automatic-commits instruction.
- Do not implement catalog, engine, MCP tools, external services, or health endpoints in this task.
- Preserve existing user files and do not revert unrelated changes.
