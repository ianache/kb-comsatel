# Task 3 Report

Status: DONE

## Changed files

- `src/catalog/repository.ts`
- `src/catalog/memory-repository.ts`
- `src/catalog/seed.ts`
- `tests/catalog/memory-repository.test.ts`

## TDD red evidence

Command:

```text
npm test -- tests/catalog/memory-repository.test.ts
```

Output before implementation:

```text
> test
> vitest run tests/catalog/memory-repository.test.ts
 RUN  v3.2.7 D:/02-PERSONAL/01-PROJECTS/38-KB-Comsatel
 Test Files  1 failed (1)
      Tests  no tests
   Start at  23:16:29
   Duration  6.19s (transform 59ms, setup 0ms, collect 0ms, tests 0ms, environment 0ms, prepare 210ms)
⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  tests/catalog/memory-repository.test.ts [ tests/catalog/memory-repository.test.ts ]
Error: Cannot find module '../../src/catalog/seed.js' imported from 'D:/02-PERSONAL/01-PROJECTS/38-KB-Comsatel/tests/catalog/memory-repository.test.ts'
 ❯ tests/catalog/memory-repository.test.ts:2:1
      1| import { describe, expect, it } from "vitest";
      2| import { createSeedRepository } from "../../src/catalog/seed.js";
       | ^
      3|
      4| const publicPrincipal = {
Caused by: Error: Failed to load url ../../src/catalog/seed.js (resolved id: ../../src/catalog/seed.js) in D:/02-PERSONAL/01-PROJECTS/38-KB-Comsatel/tests/catalog/memory-repository.test.ts. Does the file exist?
 ❯ loadAndTransform node_modules/vite/dist/node/chunks/config.js:22739:33
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
```

## Validation evidence

Command:

```text
npm test -- tests/catalog/memory-repository.test.ts
```

Output:

```text
> test
> vitest run tests/catalog/memory-repository.test.ts
 RUN  v3.2.7 D:/02-PERSONAL/01-PROJECTS/38-KB-Comsatel
 ✓ tests/catalog/memory-repository.test.ts (5 tests) 18ms
 Test Files  1 passed (1)
      Tests  5 passed (5)
   Start at  23:19:21
   Duration  6.38s (transform 133ms, setup 0ms, collect 466ms, tests 18ms, environment 0ms, prepare 178ms)
```

Command:

```text
npm run typecheck
```

Output:

```text
> typecheck
> tsc -p tsconfig.json --noEmit
```

Command:

```text
npm run format:check
```

Output:

```text
> format:check
> prettier --ignore-unknown --check src tests package.json tsconfig.json vitest.config.ts .env.example
Checking formatting...
All matched files use Prettier code style!
```

Additional check:

```text
git diff --check
```

Output: no output (exit code 0).

## Review fix: source and scope payloads

Updated `citationSchema` and `provenanceSchema` to include `sourceSystem` and
artifact `scope` (`product` and `domain`). Provenance now also includes the
artifact `locator`. The in-memory repository and seeded provenance map these
fields from their artifacts.

### TDD red evidence

Command:

```text
npm test -- tests/catalog/memory-repository.test.ts
```

Output before the fix:

```text
> test
> vitest run tests/catalog/memory-repository.test.ts
 RUN  v3.2.7 D:/02-PERSONAL/01-PROJECTS/38-KB-Comsatel
 ❯ tests/catalog/memory-repository.test.ts (5 tests | 2 failed) 30ms
   × MemoryKnowledgeRepository > returns stable public evidence 19ms
     → expected { …(7) } to match object { sourceSystem: 'gitlab', …(2) }
   ✓ MemoryKnowledgeRepository > does not reveal restricted artifacts without the group 3ms
   ✓ MemoryKnowledgeRepository > applies filters before deterministic term-overlap ranking 1ms
   × MemoryKnowledgeRepository > returns only stale artifacts and exposes their provenance 4ms
     → expected { …(7) } to match object { …(4) }
   ✓ MemoryKnowledgeRepository > returns the cgo taxonomy to authorized principals 1ms
 Test Files  1 failed (1)
      Tests  2 failed | 3 passed (5)
   Start at  23:25:53
   Duration  6.35s (transform 117ms, setup 0ms, collect 415ms, tests 30ms, environment 0ms, prepare 181ms)
```

### Validation evidence

Command:

```text
npm test -- tests/catalog/memory-repository.test.ts
```

Output:

```text
> test
> vitest run tests/catalog/memory-repository.test.ts
 RUN  v3.2.7 D:/02-PERSONAL/01-PROJECTS/38-KB-Comsatel
 ✓ tests/catalog/memory-repository.test.ts (5 tests) 17ms
 Test Files  1 passed (1)
      Tests  5 passed (5)
   Start at  23:26:31
   Duration  6.03s (transform 84ms, setup 0ms, collect 213ms, tests 17ms, environment 0ms, prepare 189ms)
```

Command:

```text
npm run typecheck
```

Output:

```text
> typecheck
> tsc -p tsconfig.json --noEmit
```

Command:

```text
npm run format:check
```

Output:

```text
> format:check
> prettier --ignore-unknown --check src tests package.json tsconfig.json vitest.config.ts .env.example
Checking formatting...
All matched files use Prettier code style!
```
