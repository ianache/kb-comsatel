# I5-A GitLab Source Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Leer un corpus OKF Markdown desde un proyecto GitLab y una revisión fija, compilarlo con I4-A y preservar procedencia sin realizar mutaciones remotas.

**Architecture:** `GitLabSourcePort` abstrae el listado y lectura de archivos. `GitLabHttpSourceAdapter` usa únicamente GET de GitLab v4 y `FakeGitLabSourceAdapter` permite pruebas offline. `OkfSourceReader` unifica archivos locales y remotos; `compileOkfCorpus` conserva su API local y añade una entrada por fuente para que el CLI pueda validar/compilar GitLab sin cambiar I3 ni I4-B.

**Tech Stack:** Node.js 22, TypeScript, Zod 4, `fetch` nativo, Vitest, GitLab REST API v4 y `tsx`.

**Spec:** `docs/superpowers/specs/2026-09-05-i5a-gitlab-source-ingestion-design.md`

## Global Constraints

- El repositorio de aplicación sigue siendo GitHub; GitLab solo es fuente remota read-only.
- No usar POST, PUT, PATCH ni DELETE contra GitLab.
- No reutilizar el puerto de publicación para lectura; mantener interfaces separadas.
- La fuente GitLab está deshabilitada por defecto.
- El token solo entra desde `KCP_GITLAB_SOURCE_TOKEN`; nunca desde argumentos, archivos OKF, logs o resultados.
- No cambiar los siete contratos MCP ni el runtime I1/I2/I3 cuando la fuente GitLab está deshabilitada.
- Las pruebas normales no dependen de red, GitLab, MySQL ni Qdrant.
- Preservar cambios locales no relacionados y omitir el PRD legado `[DEPRECADO]KCP-ReqSpec-PRD.md`.
- Cada tarea termina con prueba dirigida, typecheck/formato y commit separado.

### Task 1: Definir contrato de fuente, errores y configuración

**Files:**

- Create: `src/ingestion/source-port.ts`
- Create: `src/ingestion/source-errors.ts`
- Modify: `src/config.ts`
- Modify: `tests/config-i3.test.ts`
- Create: `tests/ingestion/source-contracts.test.ts`

**Interfaces:**

```ts
export interface SourceFile {
  relativePath: string;
  content: string;
  sourceUri: string;
  sourceRevision: string;
}

export interface SourceTreeEntry {
  path: string;
  type: "blob" | "tree";
}

export interface GitLabSourcePort {
  resolveRevision(input: { projectId: string; ref: string }): Promise<string>;
  listTree(input: { projectId: string; ref: string; root: string }): Promise<readonly SourceTreeEntry[]>;
  readFile(input: { projectId: string; ref: string; path: string }): Promise<SourceFile>;
}
```

Configuration adds `gitlabSourceEnabled`, `gitlabSourceBaseUrl`, `gitlabSourceProjectId`, `gitlabSourceRef`, `gitlabSourceRoot`, `gitlabSourceToken`, and `gitlabSourceTimeoutMs`, defaulting disabled, empty project/token, `main`, empty root and 10000 ms. Enabled configuration must require project ID and token.

- [ ] **Step 1: Write failing contract/config tests**

Assert that a source file contains only path/content/URI/revision, that source configuration defaults disabled, and that enabled configuration without project or token throws a safe error.

- [ ] **Step 2: Run the focused tests and confirm the expected failure**

Run: `npm test -- tests/ingestion/source-contracts.test.ts tests/config-i3.test.ts`

Expected: FAIL because the source interfaces and configuration fields do not exist.

- [ ] **Step 3: Implement the contracts and config parsing**

Add the interfaces and domain error codes without importing `fetch` or GitLab SDKs. Keep the token in the internal `AppConfig` only; do not serialize it.

- [ ] **Step 4: Run checks and commit**

Run: `npm test -- tests/ingestion/source-contracts.test.ts tests/config-i3.test.ts && npm run typecheck && npx prettier --check src/config.ts src/ingestion tests/ingestion`

Commit:

```bash
git add src/ingestion/source-port.ts src/ingestion/source-errors.ts src/config.ts tests/config-i3.test.ts tests/ingestion/source-contracts.test.ts
git commit -m "feat: add GitLab source contracts and configuration"
```

### Task 2: Implement fake and HTTP GitLab source adapters

**Files:**

- Create: `src/ingestion/fake-gitlab-source-adapter.ts`
- Create: `src/ingestion/gitlab-source-schemas.ts`
- Create: `src/ingestion/gitlab-http-source-adapter.ts`
- Create: `tests/ingestion/fake-gitlab-source-adapter.test.ts`
- Create: `tests/ingestion/gitlab-http-source-adapter.test.ts`
- Create: `tests/security/gitlab-source-sensitive-output.test.ts`

**Interfaces:** `FakeGitLabSourceAdapter` and `GitLabHttpSourceAdapter` implement `GitLabSourcePort`. The HTTP adapter builds `/api/v4/projects/${encodeURIComponent(projectId)}` and uses GET requests with `PRIVATE-TOKEN` and an `AbortController` timeout.

- [ ] **Step 1: Write failing adapter tests**

Test tree listing, Markdown filtering inputs, raw file response mapping, URL encoding of `comsatel/development/training/kb-demo`, revision resolution, 401/403/404/429/5xx normalization, timeout handling and absence of token/response body in errors.

- [ ] **Step 2: Run the focused adapter tests and confirm failure**

Run: `npm test -- tests/ingestion/fake-gitlab-source-adapter.test.ts tests/ingestion/gitlab-http-source-adapter.test.ts tests/security/gitlab-source-sensitive-output.test.ts`

Expected: FAIL because the source adapters and schemas do not exist.

- [ ] **Step 3: Implement schemas and fake adapter**

Accept only required response fields and tolerate extra GitLab fields with `.passthrough()`. The fake stores a revision, tree and file contents in memory and records only sanitized operation names.

- [ ] **Step 4: Implement the HTTP adapter**

Use GET tree, raw file and commit endpoints. Sort tree entries by path, return only the minimal source metadata, normalize 401/403/404/429/5xx and never include response bodies in errors.

- [ ] **Step 5: Run checks and commit**

Run: `npm test -- tests/ingestion/fake-gitlab-source-adapter.test.ts tests/ingestion/gitlab-http-source-adapter.test.ts tests/security/gitlab-source-sensitive-output.test.ts && npm run typecheck && npx prettier --check src/ingestion tests/ingestion tests/security`

Commit:

```bash
git add src/ingestion tests/ingestion tests/security/gitlab-source-sensitive-output.test.ts
git commit -m "feat: add read-only GitLab source adapters"
```

### Task 3: Unify local and remote OKF readers

**Files:**

- Modify: `src/okf/corpus-reader.ts`
- Modify: `src/okf/compiler.ts`
- Modify: `src/okf/okf-types.ts`
- Create: `src/okf/source-reader.ts`
- Modify: `tests/okf/compiler.test.ts`
- Create: `tests/okf/gitlab-source-compiler.test.ts`

**Interfaces:**

```ts
export interface OkfCorpusSource {
  read(): Promise<readonly RawOkfFile[]>;
}

export function compileOkfSource(
  source: OkfCorpusSource,
  options: CompileOptions,
): Promise<CompiledCorpus>;
```

Keep `compileOkfCorpus(inputDir, options)` as a compatibility wrapper around the local filesystem source. The remote reader injects default GitLab `sourceUri` and commit SHA only when the document frontmatter does not provide them; explicit OKF metadata remains authoritative. The source path remains stable in `file` and corpus hashing includes the resolved metadata.

- [ ] **Step 1: Write failing remote compiler tests**

Use `FakeGitLabSourceAdapter` to compile the valid fixture content remotely, assert deterministic hash/order, one stable document, GitLab source URI/revision defaults and invalid corpus behavior.

- [ ] **Step 2: Run the focused compiler tests and confirm failure**

Run: `npm test -- tests/okf/compiler.test.ts tests/okf/gitlab-source-compiler.test.ts`

Expected: FAIL because `compileOkfSource` and the source reader abstraction do not exist.

- [ ] **Step 3: Implement the reader abstraction and compiler entry point**

Move only file-reading concerns behind `OkfCorpusSource`. Preserve all governance, duplicate-ID, warning, hash and projection behavior. Do not alter local compiler outputs.

- [ ] **Step 4: Run regression checks and commit**

Run: `npm test -- tests/okf/compiler.test.ts tests/okf/gitlab-source-compiler.test.ts && npm run typecheck && npx prettier --check src/okf tests/okf`

Commit:

```bash
git add src/okf tests/okf
git commit -m "feat: compile OKF from local or remote sources"
```

### Task 4: Add explicit source-selection CLI

**Files:**

- Modify: `src/ingestion/okf-cli.ts`
- Modify: `package.json`
- Create: `tests/ingestion/okf-source-cli.test.ts`
- Modify: `docs/manual-tests/08-i4b-gitlab-publication.md`

Add flags `--source local|gitlab`, `--source-dir`, `--project-id`, `--ref` and `--root` while preserving existing positional local commands. For GitLab mode, load config, create the HTTP source adapter, resolve the commit SHA, compile through `compileOkfSource`, and print only counts/hash/revision/routes. `validate` never writes; `compile` writes the existing projection format. `index` remains local-only in I5-A and returns a safe scope error for GitLab source rather than silently indexing a different corpus.

- [ ] **Step 1: Write failing CLI tests**

Assert local commands remain compatible, GitLab mode requires explicit enablement, plan/validate output omits content and token, and GitLab `index` is rejected with a clear non-mutating error.

- [ ] **Step 2: Run focused CLI tests and confirm failure**

Run: `npm test -- tests/ingestion/okf-cli.test.ts tests/ingestion/okf-source-cli.test.ts`

Expected: FAIL because source selection is not implemented.

- [ ] **Step 3: Implement parser and runtime composition**

Use `createRuntimeGitLabSource(config)` only when explicitly enabled. Reuse the existing compiler and projection writer; do not introduce a second validation path.

- [ ] **Step 4: Add npm script and documentation**

Add `okf:source-validate` and `okf:source-compile`, document the GitLab source variables and the difference between local application checkout and remote knowledge repository.

- [ ] **Step 5: Run checks and commit**

Run: `npm test -- tests/ingestion/okf-cli.test.ts tests/ingestion/okf-source-cli.test.ts && npm run typecheck && npm run build && npx prettier --check src/ingestion package.json tests/ingestion docs/manual-tests`

Commit:

```bash
git add src/ingestion package.json package-lock.json tests/ingestion docs/manual-tests/08-i4b-gitlab-publication.md
git commit -m "feat: add GitLab source selection to OKF CLI"
```

### Task 5: Add manual validation and CI offline coverage

**Files:**

- Create: `docs/manual-tests/09-i5a-gitlab-source-ingestion.md`
- Modify: `docs/manual-tests/README.md`
- Modify: `.gitlab-ci.yml`
- Create: `tests/ingestion/i5a-source-acceptance.test.ts`

Document and test: source configuration, project ID `587` or path, fixed `main` ref, recursive Markdown discovery, deterministic hash, provenance, no mutation, invalid credentials, inaccessible paths and safe output. Keep the standard CI job offline using the fake adapter; real GitLab execution is opt-in and protected.

- [ ] **Step 1: Write the offline acceptance tests**

Use the fake adapter to compile a remote fixture twice and assert equal hash/order, one stable projection, GitLab URI/revision, and no mutation methods.

- [ ] **Step 2: Run the acceptance test and confirm its initial failure**

Run: `npm test -- tests/ingestion/i5a-source-acceptance.test.ts`

Expected: FAIL until source selection and compiler integration are complete.

- [ ] **Step 3: Add manual test instructions and CI job**

Add the manual test to the index and run it in CI with fake/offline tests only. The real GitLab case must require an explicit protected variable such as `KCP_GITLAB_SOURCE_INTEGRATION=true`.

- [ ] **Step 4: Run final verification and commit**

Run: `npm test -- tests/ingestion tests/okf tests/security && npm run typecheck && npm run build && npm run smoke && git diff --check`

Commit:

```bash
git add .gitlab-ci.yml docs/manual-tests tests/ingestion/i5a-source-acceptance.test.ts
git commit -m "test: add I5-A GitLab source ingestion verification"
```

## Final Verification

After all tasks, run:

```bash
npm test -- tests/ingestion tests/okf tests/publication tests/security
npm run typecheck
npm run build
npm run smoke
npx prettier --check src tests package.json .gitlab-ci.yml docs/manual-tests
```

The full suite may retain the previously observed health/STDIO timeout flakiness; report it separately and do not attribute it to I5-A without a focused failure.
