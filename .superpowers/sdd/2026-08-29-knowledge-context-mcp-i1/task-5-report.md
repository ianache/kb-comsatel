# Task 5 Validation Report

## Implementation

- Added `src/mcp/adapter.ts` with `createMcpServer(engine): McpServer`.
- Added `src/mcp/tools.ts` with seven read-only MCP tools backed by `ContextEngine`.
- Added `src/mcp/resources.ts` with three `km://` resource templates backed by engine reads.
- Updated `src/server.ts` so `--stdio` creates config, seed repository, audit sink, engine, MCP server, and `StdioServerTransport`.
- Added `tests/mcp/stdio-contract.test.ts` that spawns `node dist/server.js --stdio` through `StdioClientTransport`.

## Test-First Evidence

Command run before MCP implementation:

```text
rtk npm run build; if ($LASTEXITCODE -eq 0) { rtk npm test -- tests/mcp/stdio-contract.test.ts }
```

Result:

```text
> build
> tsc -p tsconfig.json
> test
> vitest run tests/mcp/stdio-contract.test.ts
 RUN  v3.2.7 D:/02-PERSONAL/01-PROJECTS/38-KB-Comsatel
 ❯ tests/mcp/stdio-contract.test.ts (3 tests | 3 failed) 21182ms
   × MCP stdio contract > exposes read-only knowledge tools and resource templates 7092ms
     → Test timed out in 5000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
   × MCP stdio contract > returns cited search evidence for the public seed catalog 7029ms
     → Test timed out in 5000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
   × MCP stdio contract > returns a structured invalid-input error for invalid search limits 7058ms
     → Test timed out in 5000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 Test Files  1 failed (1)
      Tests  3 failed (3)
   Start at  23:51:45
   Duration  28.20s (transform 66ms, setup 0ms, collect 587ms, tests 21.18s, environment 0ms, prepare 194ms)
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  tests/mcp/stdio-contract.test.ts > MCP stdio contract > exposes read-only knowledge tools and resource templates
Error: Test timed out in 5000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ tests/mcp/stdio-contract.test.ts:31:3
     29|
     30| describe("MCP stdio contract", () => {
     31|   it("exposes read-only knowledge tools and resource templates", async…
       |   ^
     32|     const mcpClient = await connectClient();
     33|
⎯⎯⎯⎯⎯⎯⎯⎯[1/3]⎯
 FAIL  tests/mcp/stdio-contract.test.ts > MCP stdio contract > returns cited search evidence for the public seed catalog
Error: Test timed out in 5000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ tests/mcp/stdio-contract.test.ts:60:3
     58|   });
     59|
     60|   it("returns cited search evidence for the public seed catalog", asyn…
       |   ^
     61|     const mcpClient = await connectClient();
     62|
⎯⎯⎯⎯⎯⎯⎯⎯[2/3]⎯
 FAIL  tests/mcp/stdio-contract.test.ts > MCP stdio contract > returns a structured invalid-input error for invalid search limits
Error: Test timed out in 5000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ tests/mcp/stdio-contract.test.ts:90:3
     88|   });
     89|
     90|   it("returns a structured invalid-input error for invalid search limi…
       |   ^
     91|     const mcpClient = await connectClient();
     92|
⎯⎯⎯⎯⎯⎯⎯⎯[3/3]⎯
```

## Validation Evidence

Formatting fix run after the first full gate reported style warnings:

```text
rtk npx prettier --write src/mcp/resources.ts src/mcp/tools.ts
```

Result:

```text
Prettier: All files formatted correctly
```

Fresh required validation command:

```text
rtk proxy npm run build; if ($LASTEXITCODE -eq 0) { rtk proxy npm test -- tests/mcp/stdio-contract.test.ts }; if ($LASTEXITCODE -eq 0) { rtk proxy npm run typecheck }; if ($LASTEXITCODE -eq 0) { rtk proxy npm run format:check }
```

Result:

```text
> build
> tsc -p tsconfig.json


> test
> vitest run tests/mcp/stdio-contract.test.ts


 RUN  v3.2.7 D:/02-PERSONAL/01-PROJECTS/38-KB-Comsatel

 ✓ tests/mcp/stdio-contract.test.ts (3 tests) 6627ms
   ✓ MCP stdio contract > exposes read-only knowledge tools and resource templates  2253ms
   ✓ MCP stdio contract > returns cited search evidence for the public seed catalog  2173ms
   ✓ MCP stdio contract > returns a structured invalid-input error for invalid search limits  2199ms

 Test Files  1 passed (1)
      Tests  3 passed (3)
   Start at  23:57:08
   Duration  16.91s (transform 94ms, setup 0ms, collect 758ms, tests 6.63s, environment 0ms, prepare 314ms)


> typecheck
> tsc -p tsconfig.json --noEmit


> format:check
> prettier --ignore-unknown --check src tests package.json tsconfig.json vitest.config.ts .env.example

Checking formatting...
 All matched files use Prettier code style!
```

## Review Fix: Stdio Child Lifecycle

Root cause: `StdioClientTransport.close()` ends the child stdin and waits only
up to its SDK timeout before sending `SIGTERM`/`SIGKILL`. The server's stdio
entry point did not handle stdin `end`, while its health listener kept the
child alive. In a repeated or full test run, the next child could race the
previous child for port `8787`, causing startup failure and MCP `-32000
Connection closed` errors. The server now performs the normal application
shutdown on stdin `end`. The contract test also captures piped child stderr
and includes it if cleanup fails.

Required validation command:

```text
rtk proxy npm run build; if ($LASTEXITCODE -eq 0) { rtk proxy npm test }; if ($LASTEXITCODE -eq 0) { rtk proxy npm test -- tests/mcp/stdio-contract.test.ts }; if ($LASTEXITCODE -eq 0) { rtk proxy npm run typecheck }; if ($LASTEXITCODE -eq 0) { rtk proxy npm run format:check }
```

Exact result:

```text
> build
> tsc -p tsconfig.json

> test
> vitest run

 RUN  v3.2.7 D:/02-PERSONAL/01-PROJECTS/38-KB-Comsatel

 ✓ tests/config.test.ts (2 tests) 18ms
 ✓ tests/domain/schemas.test.ts (4 tests) 24ms
 ✓ tests/catalog/memory-repository.test.ts (5 tests) 52ms
 ✓ tests/engine/context-engine.test.ts (5 tests) 43ms
 ✓ tests/ops/health-server.test.ts (4 tests) 775ms
   ✓ health server > returns a healthy response  615ms
 ✓ tests/mcp/stdio-contract.test.ts (4 tests) 13154ms
   ✓ MCP stdio contract > exposes read-only knowledge tools and resource templates  2777ms
   ✓ MCP stdio contract > returns cited search evidence for the public seed catalog  2495ms
   ✓ MCP stdio contract > returns a structured invalid-input error for invalid search limits  4566ms
   ✓ MCP stdio contract > returns structured safe errors for invalid resource inputs  3314ms

 Test Files  6 passed (6)
      Tests  24 passed (24)
   Start at  01:03:18
   Duration  27.98s (transform 794ms, setup 0ms, collect 10.49s, tests 14.07s, environment 3ms, prepare 2.50s)

> test
> vitest run tests/mcp/stdio-contract.test.ts

 RUN  v3.2.7 D:/02-PERSONAL/01-PROJECTS/38-KB-Comsatel

 ✓ tests/mcp/stdio-contract.test.ts (4 tests) 6725ms
   ✓ MCP stdio contract > exposes read-only knowledge tools and resource templates  1715ms
   ✓ MCP stdio contract > returns cited search evidence for the public seed catalog  1586ms
   ✓ MCP stdio contract > returns a structured invalid-input error for invalid search limits  1664ms
   ✓ MCP stdio contract > returns structured safe errors for invalid resource inputs  1759ms

 Test Files  1 passed (1)
      Tests  4 passed (4)
   Start at  01:03:54
   Duration  14.75s (transform 63ms, setup 0ms, collect 512ms, tests 6.72s, environment 0ms, prepare 204ms)

> typecheck
> tsc -p tsconfig.json --noEmit

> format:check
> prettier --ignore-unknown --check src tests package.json tsconfig.json vitest.config.ts .env.example

Checking formatting...
All matched files use Prettier code style!
```

## Final Fix Wave

Implemented taxonomy-by-domain lookup, exact immutable artifact revisions,
Zod validation for every tool output, explicit safe tool-input parsing,
filter-aware stale concepts, and required context-pack filters. Added focused
regression coverage for each contract. No `npm ci` was needed because the
lockfile and dependencies were unchanged; `NODE_USE_SYSTEM_CA=1` was not used.

Validation command:

```text
rtk proxy npm test; if ($LASTEXITCODE -eq 0) { rtk proxy npm run build }; if ($LASTEXITCODE -eq 0) { rtk proxy npm run typecheck }; if ($LASTEXITCODE -eq 0) { rtk proxy npm run format:check }; if ($LASTEXITCODE -eq 0) { rtk proxy npm run smoke }
```

Exact test/build/typecheck output:

```text
> test
> vitest run

 RUN  v3.2.7 D:/02-PERSONAL/01-PROJECTS/38-KB-Comsatel

 ✓ tests/config.test.ts (2 tests) 35ms
 ✓ tests/domain/schemas.test.ts (4 tests) 36ms
 ✓ tests/engine/context-engine.test.ts (6 tests) 61ms
 ✓ tests/catalog/memory-repository.test.ts (6 tests) 73ms
 ✓ tests/ops/health-server.test.ts (4 tests) 544ms
   ✓ health server > returns a healthy response  453ms
 ✓ tests/mcp/stdio-contract.test.ts (9 tests) 21013ms
   ✓ MCP stdio contract > exposes read-only knowledge tools and resource templates  2551ms
   ✓ MCP stdio contract > returns cited search evidence for the public seed catalog  2102ms
   ✓ MCP stdio contract > returns a structured invalid-input error for invalid search limits  2087ms
   ✓ MCP stdio contract > returns structured safe errors for invalid resource inputs  1696ms
   ✓ MCP stdio contract > returns taxonomy data by domain  1694ms
   ✓ MCP stdio contract > returns only the exact requested artifact revision  1881ms
   ✓ MCP stdio contract > normalizes missing tool inputs instead of returning an SDK error  2253ms
   ✓ MCP stdio contract > passes stale filters through the public tool  3283ms
   ✓ MCP stdio contract > requires context-pack filters in the public input  3462ms

 Test Files  6 passed (6)
      Tests  31 passed (31)
   Start at  01:39:27
   Duration  35.64s (transform 796ms, setup 0ms, collect 9.48s, tests 21.76s, environment 4ms, prepare 3.16s)

> build
> tsc -p tsconfig.json

> typecheck
> tsc -p tsconfig.json --noEmit
```

The first format check reported:

```text
> format:check
> prettier --ignore-unknown --check src tests package.json tsconfig.json vitest.config.ts .env.example

Checking formatting...
[warn] src/mcp/tools.ts
[warn] tests/catalog/memory-repository.test.ts
[warn] tests/mcp/stdio-contract.test.ts
[warn] Code style issues found in 3 files. Run Prettier with --write to fix.
```

Formatting correction command and output:

```text
rtk proxy npx prettier --write src/mcp/tools.ts tests/catalog/memory-repository.test.ts tests/mcp/stdio-contract.test.ts
src/mcp/tools.ts 97ms
tests/catalog/memory-repository.test.ts 20ms
tests/mcp/stdio-contract.test.ts 30ms
```

Exact final format/smoke output:

```text
> format:check
> prettier --ignore-unknown --check src tests package.json tsconfig.json vitest.config.ts .env.example

Checking formatting...
All matched files use Prettier code style!

> smoke
> build
> tsc -p tsconfig.json

smoke discovered 7 tools and 3 resource templates
```

## Review Fix: Safe Resource Errors

Root cause: `src/mcp/resources.ts` returned structured not-found payloads for
expected misses, but did not wrap resource handlers in the same safe
`KcpError`/Zod validation mapping used by tools. URI template variables also
remained percent-encoded, so invalid resource input such as `%20` was treated
as an ordinary domain and returned insufficient evidence instead of a
structured invalid-input error.

Added focused stdio contract coverage for resource error behavior. Command run
before the fix:

```text
rtk npm run build; if ($LASTEXITCODE -eq 0) { rtk npm test -- tests/mcp/stdio-contract.test.ts }
```

Result:

```text
> build
> tsc -p tsconfig.json
> test
> vitest run tests/mcp/stdio-contract.test.ts
 RUN  v3.2.7 D:/02-PERSONAL/01-PROJECTS/38-KB-Comsatel
 ❯ tests/mcp/stdio-contract.test.ts (4 tests | 1 failed) 9679ms
   ✓ MCP stdio contract > exposes read-only knowledge tools and resource templates  3405ms
   ✓ MCP stdio contract > returns cited search evidence for the public seed catalog  2027ms
   ✓ MCP stdio contract > returns a structured invalid-input error for invalid search limits  2151ms
   × MCP stdio contract > returns structured safe errors for invalid resource inputs 2094ms
     → expected { domain: '%20', citations: [], …(1) } to deeply equal { error: { …(2) } }
 Test Files  1 failed (1)
      Tests  1 failed | 3 passed (4)
   Start at  00:07:46
   Duration  21.74s (transform 240ms, setup 0ms, collect 2.50s, tests 9.68s, environment 0ms, prepare 842ms)
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  tests/mcp/stdio-contract.test.ts > MCP stdio contract > returns structured safe errors for invalid resource inputs
AssertionError: expected { domain: '%20', citations: [], …(1) } to deeply equal { error: { …(2) } }
- Expected
+ Received
  {
-   "error": {
-     "code": "INVALID_INPUT",
-     "message": "Invalid taxonomy resource input",
-   },
+   "citations": [],
+   "domain": "%20",
+   "evidenceStatus": "insufficient",
  }
 ❯ tests/mcp/stdio-contract.test.ts:124:76
    122|     const content = result.contents[0];
    123|     expect(content?.mimeType).toBe("application/json");
    124|     expect(content && "text" in content ? JSON.parse(content.text) : n…
       |                                                                            ^
    125|       {
    126|         error: {
⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
```

Implemented a shared safe error mapper for tools and resources, decoded and
validated resource variables, and returned caught resource errors as JSON
resource contents without stacks, secrets, tokens, or JWTs. A practical stdio
KcpError trigger is not present in the seed-backed resource paths after
resource variable validation; the resource wrapper still maps `KcpError` via
the same `toSafeError` path as tools.

Formatting fix run after the first post-fix required gate reported style
warnings:

```text
rtk npx prettier --write tests/mcp/stdio-contract.test.ts
```

Result:

```text
Prettier: All files formatted correctly
```

Fresh required validation command:

```text
rtk proxy npm run build; if ($LASTEXITCODE -eq 0) { rtk proxy npm test -- tests/mcp/stdio-contract.test.ts }; if ($LASTEXITCODE -eq 0) { rtk proxy npm run typecheck }; if ($LASTEXITCODE -eq 0) { rtk proxy npm run format:check }
```

Result:

```text
> build
> tsc -p tsconfig.json


> test
> vitest run tests/mcp/stdio-contract.test.ts


 RUN  v3.2.7 D:/02-PERSONAL/01-PROJECTS/38-KB-Comsatel

 ✓ tests/mcp/stdio-contract.test.ts (4 tests) 8389ms
   ✓ MCP stdio contract > exposes read-only knowledge tools and resource templates  2279ms
   ✓ MCP stdio contract > returns cited search evidence for the public seed catalog  2141ms
   ✓ MCP stdio contract > returns a structured invalid-input error for invalid search limits  1988ms
   ✓ MCP stdio contract > returns structured safe errors for invalid resource inputs  1978ms

 Test Files  1 passed (1)
      Tests  4 passed (4)
   Start at  00:12:04
   Duration  18.08s (transform 113ms, setup 0ms, collect 772ms, tests 8.39s, environment 1ms, prepare 399ms)


> typecheck
> tsc -p tsconfig.json --noEmit


> format:check
> prettier --ignore-unknown --check src tests package.json tsconfig.json vitest.config.ts .env.example

Checking formatting...
All matched files use Prettier code style!
```
