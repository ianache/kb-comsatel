# I5-C Google Drive Source Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or **superpowers:executing-plans** to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Incorporar una fuente Google Drive de solo lectura que descubra archivos en carpetas explícitas, conserve procedencia/hash y alimente el flujo estable de compilación e indexación I5-B/I3.

**Architecture:** Crear un `GoogleDriveSourcePort` paralelo al puerto GitLab. El adaptador HTTP Google Drive v3 se encargará de paginación, autenticación Bearer, metadatos y descargas GET; una capa de normalización convertirá Markdown/PDF soportado a archivos consumibles por el compilador y entregará el resultado al orquestador I5-B sin duplicar chunking, embeddings, ACL, MySQL o Qdrant.

**Tech Stack:** TypeScript, Node.js 22, Vitest, `fetch`, `crypto.createHash`, Google Drive API v3, Zod/configuración existente, compilador OKF, orquestador I5-B e indexador I3.

**Spec:** `docs/superpowers/specs/2026-09-05-i5c-google-drive-source-design.md`

## Global Constraints

- La primera versión utiliza un token OAuth de lectura inyectado por configuración y una lista explícita de `folderId`.
- Todas las operaciones Drive de I5-C serán GET.
- El token, Authorization header, cuerpo de error y contenido completo no aparecerán en logs, excepciones ni resultados.
- La fuente estará deshabilitada por defecto y no se explorará todo Drive por defecto.
- Markdown se descarga directamente; PDF solo se acepta si un extractor configurado produce texto completo y seguro; si no, queda `skipped`/`failed` sin indexarse.
- La identidad de contenido es `sourceSystem=google-drive + fileId + revision + sha256`.
- Solo documentos OKF `stable` llegan al índice estable.
- Se reutilizan el orquestador I5-B y el indexador I3; no se crea un segundo pipeline de indexación.
- Las pruebas serán offline salvo la prueba manual autorizada contra una carpeta Drive controlada.

---

### Task 1: Definir contratos, metadatos y configuración Drive

**Files:**
- Create: `src/ingestion/google-drive-port.ts`
- Create: `src/ingestion/google-drive-errors.ts`
- Modify: `src/config.ts`
- Test: `tests/ingestion/google-drive-contracts.test.ts`
- Test: `tests/config-i5c.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface DriveFileMetadata {
    fileId: string;
    name: string;
    mimeType: string;
    sizeBytes?: number;
    version?: string;
    modifiedTime?: string;
    md5Checksum?: string;
    webUrl?: string;
    folderId: string;
    permissions: readonly {
      id: string;
      type: string;
      role: string;
    }[];
  }

  export interface DriveSourceFile {
    metadata: DriveFileMetadata;
    content: Uint8Array;
    sha256: string;
    sourceUri: string;
    sourceRevision: string;
  }

  export interface GoogleDriveSourcePort {
    listFiles(input: { folderIds: readonly string[] }): Promise<readonly DriveFileMetadata[]>;
    readFile(input: { fileId: string; metadata: DriveFileMetadata }): Promise<DriveSourceFile>;
  }
  ```
- Configuration fields: `googleDriveSourceEnabled`, `googleDriveBaseUrl`, `googleDriveFolderIds`, `googleDriveToken`, and `googleDriveTimeoutMs`.

- [ ] **Step 1: Write failing contract/config tests**

  Assert that Drive defaults are disabled, folder IDs are parsed from a comma-separated environment value, timeout is positive, and enabled mode rejects missing folders/token. Assert that `DriveFileMetadata`/`DriveSourceFile` carry file ID, folder ID, revision, URL, permissions and SHA-256 without content being part of list results.

- [ ] **Step 2: Run tests to verify the red state**

  Run: `npm test -- tests/ingestion/google-drive-contracts.test.ts tests/config-i5c.test.ts`

  Expected: FAIL because the Drive contracts and configuration fields do not exist.

- [ ] **Step 3: Implement contracts and safe configuration**

  Add strict types and a `GoogleDriveSourceError` with codes for authentication, unavailable service, invalid response, unsupported MIME and extraction failure. Parse `KCP_GOOGLE_DRIVE_FOLDER_IDS` into trimmed non-empty IDs, require it and `KCP_GOOGLE_DRIVE_TOKEN` only when `KCP_GOOGLE_DRIVE_SOURCE_ENABLED=true`, and default the API base URL to `https://www.googleapis.com/drive/v3`.

- [ ] **Step 4: Verify and commit**

  Run: `npm test -- tests/ingestion/google-drive-contracts.test.ts tests/config-i5c.test.ts && npm run typecheck`

  ```powershell
  git add src/ingestion/google-drive-port.ts src/ingestion/google-drive-errors.ts src/config.ts tests/ingestion/google-drive-contracts.test.ts tests/config-i5c.test.ts
  git commit -m "feat: add Google Drive source contracts and config"
  ```

### Task 2: Implement paginated read-only Google Drive HTTP adapter

**Files:**
- Create: `src/ingestion/google-drive-http-adapter.ts`
- Create: `src/ingestion/fake-google-drive-source.ts`
- Test: `tests/ingestion/google-drive-adapter.test.ts`

**Interfaces:**
- Consumes: `GoogleDriveSourcePort`, `DriveFileMetadata`, `DriveSourceFile`, and config from Task 1.
- Produces: `GoogleDriveHttpAdapter` with `{ baseUrl, token, timeoutMs, fetcher }` and `FakeGoogleDriveSource` for offline tests.

- [ ] **Step 1: Write failing adapter tests**

  Record fetch requests and assert that listing calls `GET /files` with `q` clauses for each explicit folder and `trashed=false`, requests explicit fields, follows `nextPageToken`, and sorts the combined result by `folderId`, `name`, `fileId`. Assert that file reads call `GET /files/{fileId}?alt=media`, use only `Authorization: Bearer`, calculate SHA-256, and return a stable source URI/revision.

  Add tests for 401/403/404/429/5xx, malformed JSON, malformed file metadata, timeout, and response bodies containing the token. Assert normalized safe errors do not expose the token/body.

- [ ] **Step 2: Run focused tests to confirm failure**

  Run: `npm test -- tests/ingestion/google-drive-adapter.test.ts`

  Expected: FAIL because the adapter modules are not present.

- [ ] **Step 3: Implement the minimal HTTP/fake adapters**

  Use `URLSearchParams` for `q`, `pageSize`, `pageToken`, and `fields`; encode file IDs with `encodeURIComponent`; follow pages until no `nextPageToken`; reject records outside configured folders or with `trashed=true`; use an `AbortController` timeout. Read response bytes with `arrayBuffer()`, compute `sha256` using `createHash("sha256")`, and map `version` or `modifiedTime + md5Checksum` to `sourceRevision`.

  Implement the fake with deterministic metadata/content and no network calls. Do not expose mutation methods on either adapter.

- [ ] **Step 4: Verify and commit**

  Run: `npm test -- tests/ingestion/google-drive-adapter.test.ts && npm run typecheck && git diff --check`

  ```powershell
  git add src/ingestion/google-drive-http-adapter.ts src/ingestion/fake-google-drive-source.ts tests/ingestion/google-drive-adapter.test.ts
  git commit -m "feat: add read-only Google Drive adapter"
  ```

### Task 3: Normalize Drive Markdown/PDF content for OKF/I5-B

**Files:**
- Create: `src/ingestion/google-drive-content.ts`
- Modify: `src/okf/corpus-reader.ts`
- Modify: `src/okf/compiler.ts` only where the existing source abstraction requires a typed Drive input
- Test: `tests/ingestion/google-drive-content.test.ts`
- Test: `tests/okf/remote-compiler.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface DriveContentExtractor {
    supports(metadata: DriveFileMetadata): boolean;
    extract(file: DriveSourceFile): Promise<{ content: string; locator?: SourceLocator }>;
  }

  export interface GoogleDriveOkfSource {
    kind: "google-drive";
    source: GoogleDriveSourcePort;
    folderIds: readonly string[];
  }
  ```
- Consumes: Drive source files and the existing `parseOkfMarkdown`/`RawOkfFile` path.

- [ ] **Step 1: Write failing normalization tests**

  Test Markdown UTF-8 normalization and OKF frontmatter parsing with injected `sourceUri`/`sourceRevision`. Test unsupported MIME returns `skipped` without compiler input. Test PDF extraction through a fake extractor returns text and optional page locator; a failed extractor returns a safe failure and never emits partial text.

- [ ] **Step 2: Run the tests to verify failure**

  Run: `npm test -- tests/ingestion/google-drive-content.test.ts tests/okf/remote-compiler.test.ts`

  Expected: FAIL because the Drive source reader/extractor boundary is not implemented.

- [ ] **Step 3: Implement normalization without extraction libraries**

  Add a Drive reader that lists metadata, reads each supported file, dispatches to the injected extractor, and produces sorted `RawOkfFile` values with `relativePath` based on `folderId/name`, source URI, source revision and content. Keep the default PDF extractor conservative: if no extractor is supplied, mark the PDF unsupported rather than indexing binary bytes as text.

- [ ] **Step 4: Verify existing local/GitLab compiler behavior**

  Run: `npm test -- tests/ingestion/google-drive-content.test.ts tests/okf/remote-compiler.test.ts tests/okf/compiler.test.ts && npm run typecheck`

  ```powershell
  git add src/ingestion/google-drive-content.ts src/okf/corpus-reader.ts src/okf/compiler.ts tests/ingestion/google-drive-content.test.ts tests/okf/remote-compiler.test.ts
  git commit -m "feat: normalize Google Drive content for OKF"
  ```

### Task 4: Reuse I5-B orchestration and expose the explicit Drive command

**Files:**
- Modify: `src/ingestion/i5b-indexing.ts`
- Modify: `src/ingestion/okf-cli.ts`
- Modify: `package.json`
- Modify: `.env.example`
- Test: `tests/ingestion/i5c-indexing.test.ts`
- Test: `tests/ingestion/okf-cli.test.ts`

**Interfaces:**
- Consumes: `GoogleDriveOkfSource`, `indexGitLabCorpus` generalized to a source-system-neutral I5-B request, and `runI3IndexingSummary`.
- Produces: `npm run okf:drive-index`, with the same safe result shape as `okf:source-index` plus Drive file/folder counts and skipped reasons.

- [ ] **Step 1: Write failing integration tests**

  Use `FakeGoogleDriveSource` plus fake compiler/indexer dependencies to assert that one stable Drive file reaches I3, draft/non-OKF files do not, and the result preserves `sourceSystem=google-drive`, `fileId`, revision, SHA-256, folder and source URL. Assert that a disabled or incomplete Drive configuration fails before any source call.

- [ ] **Step 2: Run tests to establish the gap**

  Run: `npm test -- tests/ingestion/i5c-indexing.test.ts tests/ingestion/okf-cli.test.ts`

  Expected: FAIL because I5-B currently accepts only GitLab source objects and no Drive command exists.

- [ ] **Step 3: Generalize I5-B minimally**

  Rename the internal source discriminant/typing only where necessary so `indexGitLabCorpus` becomes the exact exported function `indexRemoteCorpus`, accepting `kind: "gitlab" | "google-drive"`. Preserve the existing GitLab command/result behavior and keep the stable-only, no-write-on-errors semantics. Add Drive-specific counts without placing document content in the result.

- [ ] **Step 4: Add the npm-safe Drive CLI**

  Add `okf:drive-validate` and `okf:drive-index` scripts with fixed `--source google-drive` arguments, matching the existing npm-safe GitLab scripts. Load `KCP_GOOGLE_DRIVE_*`, construct the HTTP adapter and content extractor, and pass the normalized source to the neutral I5-B orchestrator. Keep `okf:index`, `okf:source-index`, and local behavior unchanged.

- [ ] **Step 5: Verify and commit**

  Run: `npm test -- tests/ingestion/i5c-indexing.test.ts tests/ingestion/okf-cli.test.ts tests/ingestion/i5b-indexing.test.ts && npm run typecheck`

  ```powershell
  git add src/ingestion/i5b-indexing.ts src/ingestion/okf-cli.ts package.json .env.example tests/ingestion/i5c-indexing.test.ts tests/ingestion/okf-cli.test.ts
  git commit -m "feat: index Google Drive through I5-B"
  ```

### Task 5: Prove Drive idempotence, security and failure isolation

**Files:**
- Create: `tests/ingestion/i5c-idempotence.test.ts`
- Create: `tests/security/google-drive-sensitive-output.test.ts`
- Modify: `tests/retrieval/ingestion-indexer.test.ts` only for a missing source-system/revision assertion

**Interfaces:**
- Consumes: fake Drive source, neutral I5-B orchestrator, existing catalog/vector fakes and HTTP fetcher recorder.
- Produces: acceptance evidence for `fileId + revision + SHA-256` idempotence and safe error handling.

- [ ] **Step 1: Write failing idempotence/security tests**

  Execute the same Drive file twice and assert the second run skips it. Change version/content and assert one new revision is indexed. Assert a second folder containing the same `fileId` is deduplicated. Capture HTTP errors and CLI output and assert neither OAuth token, Authorization header, response body nor Markdown/PDF text appears.

- [ ] **Step 2: Run focused tests to verify failure**

  Run: `npm test -- tests/ingestion/i5c-idempotence.test.ts tests/security/google-drive-sensitive-output.test.ts`

  Expected: FAIL until Drive identity propagation and output sanitization are complete.

- [ ] **Step 3: Implement only the missing identity/error behavior**

  Ensure the canonical source revision includes Drive version/fallback and SHA-256 is computed before compilation. Use existing I3 revision/content-hash checks; do not add a parallel deduplication store. Normalize all fetch/extractor failures to safe domain errors and preserve per-file isolation.

- [ ] **Step 4: Verify and commit**

  Run: `npm test -- tests/ingestion/i5c-idempotence.test.ts tests/security/google-drive-sensitive-output.test.ts tests/retrieval/ingestion-indexer.test.ts && npm run typecheck`

  ```powershell
  git add tests/ingestion/i5c-idempotence.test.ts tests/security/google-drive-sensitive-output.test.ts tests/retrieval/ingestion-indexer.test.ts
  git commit -m "test: verify Google Drive idempotence and safe output"
  ```

### Task 6: Add manual tests and final verification

**Files:**
- Create: `docs/manual-tests/11-i5c-google-drive-source.md`
- Modify: `docs/manual-tests/README.md`
- Create: `tests/ingestion/i5c-source-acceptance.test.ts`
- Modify: `.gitlab-ci.yml` only if the offline tests are not included by the existing test job

**Interfaces:**
- Consumes: `npm run okf:drive-validate`, `npm run okf:drive-index`, fake acceptance fixtures and current I5-B manual conventions.
- Produces: repeatable offline/authorized validation without Drive mutations.

- [ ] **Step 1: Write the acceptance test**

  Cover paginated listing, deterministic order, Markdown indexing, PDF unsupported/failed behavior, stable-only filtering, invalid corpus no-op, repeat idempotence, changed version, and absence of mutating Drive methods.

- [ ] **Step 2: Run the acceptance test**

  Run: `npm test -- tests/ingestion/i5c-source-acceptance.test.ts`

  Expected: PASS after Tasks 1–5; if it fails, correct the integration before documenting success.

- [ ] **Step 3: Write the manual test document**

  Document offline fake commands, disabled-by-default behavior, OAuth/folder environment variables, authorized folder execution, expected safe JSON, idempotent repeat, changed revision, PDF handling, and cleanup limited to temporary environment variables. Explicitly state that no POST/PUT/PATCH/DELETE calls or Drive mutations are permitted.

- [ ] **Step 4: Run final verification**

  ```powershell
  npm run build
  npm run typecheck
  npm test -- tests/ingestion/i5c-source-acceptance.test.ts tests/ingestion/i5c-idempotence.test.ts tests/ingestion/i5c-indexing.test.ts tests/ingestion/google-drive-adapter.test.ts tests/ingestion/google-drive-content.test.ts
  npm run smoke
  git diff --check
  ```

  Expected: build, typecheck, focused Drive/I5-C tests, smoke and diff check pass. Run the full suite after building `dist`; if stdio tests exceed the default timeout, repeat with `npx vitest run --testTimeout=15000` and report the timeout separately.

- [ ] **Step 5: Update Graphify and commit documentation**

  ```powershell
  python -m graphify update .
  git add docs/manual-tests/11-i5c-google-drive-source.md docs/manual-tests/README.md tests/ingestion/i5c-source-acceptance.test.ts .gitlab-ci.yml
  git commit -m "test: document I5-C Google Drive acceptance"
  ```

## Final review checklist

- [ ] Every section of the I5-C specification maps to at least one task.
- [ ] No Drive mutation method exists in the adapter or port.
- [ ] Folder scope, pagination, ordering, metadata, version and SHA-256 are tested.
- [ ] Markdown and PDF unsupported/extraction-failure behavior is explicit.
- [ ] OAuth token/body/document content are absent from errors and output.
- [ ] I5-B GitLab and local I3 behavior remain unchanged.
- [ ] Existing user changes outside I5-C are preserved.
