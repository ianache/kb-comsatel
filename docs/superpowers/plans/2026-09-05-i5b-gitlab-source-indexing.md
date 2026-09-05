# I5-B GitLab Source Indexing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Indexar de forma explícita y segura los documentos `stable` de un corpus OKF remoto en GitLab mediante el compilador y el indexador I3 existentes, con idempotencia por revisión y hash.

**Architecture:** Añadir una capa de aplicación I5-B que resuelva la fuente GitLab read-only de I5-A, compile el corpus, escriba una proyección temporal y delegue la indexación al `IngestionIndexer` I3 existente. La capa recibirá adaptadores de compilación/indexación inyectables para probar éxito, idempotencia, cambios de revisión y fallos sin levantar MySQL/Qdrant reales.

**Tech Stack:** TypeScript, Node.js 22, Vitest, Zod, filesystem projection, MySQL catalog writer, Qdrant vector store, adaptador GitLab HTTP/fake existente.

**Spec:** `docs/superpowers/specs/2026-09-05-i5b-gitlab-source-indexing-design.md`

## Global Constraints

- Solo se indexan documentos `stable`; los demás estados permanecen fuera del índice estable.
- GitLab se utiliza únicamente mediante operaciones GET; no se crean ramas, commits ni Merge Requests.
- El token GitLab no puede aparecer en resultados, excepciones, logs ni pruebas.
- Los errores de compilación no pueden modificar MySQL, Qdrant ni la proyección final.
- La ejecución remota debe estar deshabilitada por defecto y ser explícita.
- Se reutilizan `compileOkfCorpus`, `writeProjection` e `IngestionIndexer`; no se crea un segundo indexador.
- La identidad de ejecución es `sourceSystem + projectId + resolvedRevision + corpusHash`.
- Las pruebas deben ser offline salvo el caso manual autorizado contra GitLab.

---

### Task 1: Definir el contrato y orquestador I5-B

**Files:**
- Create: `src/ingestion/i5b-indexing.ts`
- Test: `tests/ingestion/i5b-indexing.test.ts`
- Modify: `src/ingestion/source-errors.ts` if a safe source/indexing error code is missing

**Interfaces:**
- Consumes: `OkfCorpusSource`, `CompiledCorpus`, `writeProjection`, and an injected projection indexer.
- Produces:
  ```ts
  export interface I5BIndexRequest {
    source: OkfCorpusSource;
    outputDir: string;
    mode: "stable";
  }

  export interface I5BIndexResult {
    projectId: string;
    ref: string;
    resolvedRevision: string;
    corpusHash: string;
    counts: CompiledCorpus["manifest"]["counts"];
    status: "indexed" | "skipped" | "failed";
    indexed: number;
    skipped: number;
    chunks: number;
    vectors: number;
  }

  export interface I5BIndexDependencies {
    compile(source: OkfCorpusSource, options: { mode: "stable" }): Promise<CompiledCorpus>;
    write(corpus: CompiledCorpus, outputDir: string): Promise<void>;
    index(outputDir: string): Promise<IngestionSummary>;
  }
  ```

- [ ] **Step 1: Write failing tests for the orchestration contract**

  Add tests proving that a valid stable corpus calls `compile`, `write`, and `index` in that order and returns project, ref, SHA, hash, counts, and index summary. Add a test where `compile` returns errors and assert that `write`/`index` are not called and the result is `failed` with no mutation.

- [ ] **Step 2: Run the focused test to verify it fails**

  Run: `npm test -- tests/ingestion/i5b-indexing.test.ts`

  Expected: FAIL because the I5-B module and orchestration function do not exist.

- [ ] **Step 3: Implement the minimal orchestrator**

  Export `indexGitLabCorpus(request, dependencies)`. Resolve `projectId`, `ref`, and `resolvedRevision` from the GitLab source request; compile with `{ mode: "stable" }`; return `failed` before projection/indexing when `corpus.errors.length > 0`; otherwise write the projection and invoke the injected indexer. Never include source contents or credentials in the returned object.

- [ ] **Step 4: Run focused tests and typecheck**

  Run: `npm test -- tests/ingestion/i5b-indexing.test.ts && npm run typecheck`

  Expected: PASS with all orchestration tests green and no TypeScript errors.

- [ ] **Step 5: Commit the contract**

  ```powershell
  git add src/ingestion/i5b-indexing.ts tests/ingestion/i5b-indexing.test.ts src/ingestion/source-errors.ts
  git commit -m "feat: add I5-B remote indexing orchestrator"
  ```

### Task 2: Connect the orchestrator to the existing I3 runtime

**Files:**
- Modify: `src/ingestion/i3-cli.ts`
- Modify: `src/ingestion/okf-cli.ts`
- Modify: `src/ops/runtime-dependencies.ts` only if dependency construction must be exposed for injection
- Test: `tests/ingestion/i5b-indexing.test.ts`
- Test: `tests/ingestion/okf-cli.test.ts`

**Interfaces:**
- Consumes: `indexGitLabCorpus`, `loadConfig`, `GitLabHttpSourceAdapter`, `createRuntimeDependencies`, and `runI3Indexing`.
- Produces: a real dependency factory that indexes the projection directory with the current I3 runtime and returns `IngestionSummary`.

- [ ] **Step 1: Add failing integration tests with fakes**

  Extend the I5-B tests with a fake GitLab source containing one valid stable document and a recording indexer. Assert that the output projection contains only `documents/<knowledgeId>.md`, the manifest preserves `sourceRevision`, and the injected indexer receives the projection directory. Add a mixed stable/draft corpus test asserting only stable content is projected.

- [ ] **Step 2: Run the tests and verify the missing integration**

  Run: `npm test -- tests/ingestion/i5b-indexing.test.ts tests/ingestion/okf-cli.test.ts`

  Expected: FAIL for the not-yet-wired I5-B command path or missing injectable runtime adapter.

- [ ] **Step 3: Implement the I3 bridge**

  Extract a small function from `i3-cli.ts` that accepts an explicit projection directory and environment, creates the existing runtime, calls `runtime.indexer.ingest()`, closes runtime/dependencies in `finally`, and returns the summary. Keep `runI3Indexing` as the backward-compatible CLI wrapper. Do not alter local I3 defaults.

  Wire GitLab `index` execution in `okf-cli.ts` through `indexGitLabCorpus`; local `index` continues using the existing local path. If the source is GitLab and I3 is disabled, return a safe configuration error before reading/indexing.

- [ ] **Step 4: Verify focused integration**

  Run: `npm test -- tests/ingestion/i5b-indexing.test.ts tests/ingestion/okf-cli.test.ts tests/retrieval/ingestion-indexer.test.ts && npm run typecheck`

  Expected: PASS; local I3 tests remain unchanged and GitLab indexing is explicit.

- [ ] **Step 5: Commit the I3 bridge**

  ```powershell
  git add src/ingestion/i3-cli.ts src/ingestion/okf-cli.ts tests/ingestion/i5b-indexing.test.ts tests/ingestion/okf-cli.test.ts
  git commit -m "feat: connect GitLab source indexing to I3"
  ```

### Task 3: Add idempotence and revision-change acceptance tests

**Files:**
- Create: `src/ingestion/fake-i5b-indexer.ts` only if an existing fake cannot record catalog/vector calls cleanly
- Test: `tests/ingestion/i5b-idempotence.test.ts`
- Test: `tests/retrieval/ingestion-indexer.test.ts` when a missing case belongs to the existing indexer

**Interfaces:**
- Consumes: `indexGitLabCorpus`, `FakeGitLabSourceAdapter`, existing fake catalog/vector/embedding patterns, and `IngestionIndexer` contracts.
- Produces: executable proof for same revision/hash skip behavior and changed revision replacement.

- [ ] **Step 1: Write failing idempotence tests**

  Run the same fake corpus twice through the I5-B path and assert that the second run reports `skipped` for the unchanged document and does not add a second active catalog/vector revision. Then run a second fake source with a new SHA and changed content; assert that the new revision is indexed and the old active revision is replaced according to the existing I3 writer/vector-store contracts.

- [ ] **Step 2: Run the focused tests to confirm the gap**

  Run: `npm test -- tests/ingestion/i5b-idempotence.test.ts`

  Expected: FAIL until the fake execution path and/or I3 assertions are implemented.

- [ ] **Step 3: Implement only the missing idempotence behavior**

  Reuse `IngestionIndexer` revision/content-hash checks. If a change is required, keep it limited to the existing catalog/vector contracts: `getRevisionState`, `replaceChunks`, `deleteByRevision`, and index-run completion/failure. Do not add a second deduplication table or bypass the catalog.

- [ ] **Step 4: Verify idempotence, replacement, and failure cleanup**

  Run: `npm test -- tests/ingestion/i5b-idempotence.test.ts tests/retrieval/ingestion-indexer.test.ts tests/retrieval/i3-acceptance.test.ts`

  Expected: PASS for repeat, changed revision, failed vector/index run cleanup, ACL payload, and stable-only projection behavior.

- [ ] **Step 5: Commit acceptance coverage**

  ```powershell
  git add src/ingestion/fake-i5b-indexer.ts tests/ingestion/i5b-idempotence.test.ts tests/retrieval/ingestion-indexer.test.ts
  git commit -m "test: verify I5-B idempotent remote indexing"
  ```

### Task 4: Add explicit CLI/configuration and safe output

**Files:**
- Modify: `src/ingestion/okf-cli.ts`
- Modify: `package.json`
- Modify: `.env.example`
- Test: `tests/ingestion/okf-cli.test.ts`
- Test: `tests/config-i3.test.ts` or a new `tests/config-i5b.test.ts`

**Interfaces:**
- Consumes: existing `KCP_GITLAB_SOURCE_*`, I3 configuration, and `indexGitLabCorpus`.
- Produces: `npm run okf:source-index` as the explicit remote indexing command, with safe JSON result and nonzero error codes.

- [ ] **Step 1: Write failing CLI/configuration tests**

  Assert that the dedicated command is disabled unless `KCP_GITLAB_SOURCE_ENABLED=true`, requires source project/token, refuses remote indexing when I3 is disabled, and prints only project, revision, hash, counts, and summary. Add a sensitive-output assertion that a fake token and Markdown body never occur in captured output.

- [ ] **Step 2: Run the tests and verify failure**

  Run: `npm test -- tests/ingestion/okf-cli.test.ts tests/config-i5b.test.ts`

  Expected: FAIL because the dedicated command/result path is not yet present.

- [ ] **Step 3: Implement the explicit command**

  Add `okf:source-index` to `package.json` invoking `tsx src/ingestion/okf-cli.ts index --source gitlab`. Ensure npm-safe argument handling by putting the source mode in the script itself. Keep `okf:index` local and backward-compatible. Emit one safe JSON summary and return `0` only for `indexed` or a clearly defined no-stable `skipped` result; return `1` for corpus validation errors and `2` for configuration/transport/runtime errors.

- [ ] **Step 4: Verify command behavior**

  Run:

  ```powershell
  npm run okf:source-index
  npm run typecheck
  npm test -- tests/ingestion/okf-cli.test.ts tests/config-i5b.test.ts
  ```

  Expected: the unconfigured command fails safely; focused tests pass; no secret or document body appears.

- [ ] **Step 5: Commit the CLI surface**

  ```powershell
  git add src/ingestion/okf-cli.ts package.json .env.example tests/ingestion/okf-cli.test.ts tests/config-i5b.test.ts
  git commit -m "feat: expose explicit GitLab source indexing command"
  ```

### Task 5: Add manual tests, acceptance fixture, and verification gates

**Files:**
- Create: `docs/manual-tests/10-i5b-gitlab-source-indexing.md`
- Create: `tests/ingestion/i5b-source-acceptance.test.ts`
- Modify: `docs/manual-tests/README.md`
- Modify: `.gitlab-ci.yml` only if the existing test job does not run the new offline suite

**Interfaces:**
- Consumes: the final `okf:source-index` command, fake source/indexer, and existing manual-test conventions.
- Produces: repeatable offline acceptance and an authorized GitLab demonstration script.

- [ ] **Step 1: Write the acceptance test first**

  Cover: stable corpus indexes; stable plus draft projects only stable; invalid corpus does not invoke indexing; same revision is idempotent; changed revision replaces the previous one; GitLab source remains read-only; safe result excludes token/content.

- [ ] **Step 2: Run the acceptance test to establish the baseline**

  Run: `npm test -- tests/ingestion/i5b-source-acceptance.test.ts`

  Expected: FAIL until the complete I5-B flow is wired.

- [ ] **Step 3: Add the manual test document**

  Document offline commands, expected JSON fields, cleanup of only `.tmp/i5b-*`, authorized variables for project `587` without a real token, repeat execution, changed revision, and checks that no GitLab branch/commit/MR was created.

- [ ] **Step 4: Run final verification**

  Run:

  ```powershell
  npm run build
  npm run typecheck
  npm test -- tests/ingestion/i5b-source-acceptance.test.ts tests/ingestion/i5b-idempotence.test.ts tests/ingestion/i5b-indexing.test.ts
  npm run smoke
  git diff --check
  ```

  Expected: build, typecheck, focused acceptance, smoke, and diff check pass. Run the full suite after `dist` is built; if stdio tests exceed the default 5-second Vitest timeout, record the timeout separately and repeat with `npx vitest run --testTimeout=15000`.

- [ ] **Step 5: Update Graphify and commit documentation**

  ```powershell
  python -m graphify update .
  git add docs/manual-tests/10-i5b-gitlab-source-indexing.md tests/ingestion/i5b-source-acceptance.test.ts docs/manual-tests/README.md .gitlab-ci.yml
  git commit -m "test: document I5-B GitLab indexing acceptance"
  ```

## Final review checklist

- [ ] Every requirement in the I5-B spec maps to at least one task above.
- [ ] No code path indexes `draft`, `stale`, `deprecated`, `superseded`, or `archived` into the stable index.
- [ ] Repeated runs reuse existing I3 idempotence rather than introducing duplicate persistence.
- [ ] All GitLab calls remain GET-only and credentials are absent from output.
- [ ] Local I3 and local OKF commands retain their current behavior.
- [ ] Manual testing never authorizes writes to GitLab.
