# I4-B GitLab OKF Publication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publicar propuestas OKF válidas mediante un puerto/adaptador GitLab con ramas, commits y Merge Requests idempotentes, y permitir promoción estable solo con aprobación y CI verde.

**Architecture:** `PublicationService` coordinará compilación, reglas de gobierno, plan determinista e idempotencia contra un `GitLabPort`. `FakeGitLabAdapter` cubrirá el flujo offline; `GitLabHttpAdapter` traducirá el puerto a la API REST sin filtrar credenciales. El CLI separará `proposal`, `publication-plan` y `approved-publish`, reutilizando el compilador I4-A y el indexador I3.

**Tech Stack:** Node.js 22, TypeScript, Zod 4, `fetch` nativo, Vitest, GitLab REST API v4 y el CLI `tsx` existente.

**Spec:** `docs/superpowers/specs/2026-09-05-knowledge-context-mcp-i4b-gitlab-publication-design.md`

## Global Constraints

- El MCP continúa siendo de lectura; no se agregan herramientas MCP de mutación.
- El servicio no aprobará MRs, no cambiará estados por sí mismo y no indexará `stable` desde ramas no aprobadas.
- El token GitLab solo se obtiene desde el entorno seguro de ejecución; nunca desde archivos OKF, argumentos, UI o logs.
- La publicación será propuesta por defecto; la promoción estable será una operación separada y verificable.
- Las pruebas normales no dependerán de GitLab real.
- No forman parte de I4-B el portal React, conectores GitLab/Drive, Kafka, Docling/Tika, Vault, OKE ni el dashboard operacional.
- Cada tarea termina con pruebas enfocadas, typecheck/formato cuando corresponda y un commit separado.
- Los cambios locales no relacionados en `.gitlab-ci.yml`, `README.md`, `AGENTS.md` y documentos de requisitos se preservan.

---

### Task 1: Definir contrato de publicación y puerto GitLab

**Files:**
- Create: `src/publication/publication-types.ts`
- Create: `src/publication/publication-errors.ts`
- Create: `src/publication/gitlab-port.ts`
- Create: `src/publication/publication-plan.ts`
- Create: `tests/publication/publication-plan.test.ts`
- Create: `tests/publication/publication-errors.test.ts`

**Interfaces:**
- `PublicationMode = "proposal" | "approved-publish"`.
- `PublicationRequest` contiene `projectId`, `baseBranch`, `baseSha`, `branchPrefix`, `corpus`, `title`, `description`, `labels`, `reviewerIds`, `mode` y `correlationId`.
- `GitLabPort.getBranch(projectId, branch): Promise<GitLabBranch | null>`.
- `GitLabPort.findOpenMergeRequest(input: MergeRequestIdentity): Promise<GitLabMergeRequest | null>`.
- `GitLabPort.createBranch(input: CreateBranchInput): Promise<GitLabBranch>`.
- `GitLabPort.createCommit(input: CreateCommitInput): Promise<GitLabCommit>`.
- `GitLabPort.createMergeRequest(input: CreateMergeRequestInput): Promise<GitLabMergeRequest>`.
- `GitLabPort.getMergeRequestGate(input: MergeRequestRef): Promise<MergeRequestGate>`.
- `buildPublicationPlan(request): PublicationPlan` devuelve nombres, identidad, archivos y mensaje deterministas sin llamar GitLab.

- [ ] **Step 1: Escribir pruebas fallidas del contrato y plan**

Probar que el mismo corpus genera el mismo `branchName`, `commitMessage`, `identityKey` y lista ordenada de archivos. Probar que el plan no incluye token, cuerpo completo de documentos ni payloads GitLab.

```ts
it("builds a deterministic publication identity", () => {
  const plan = buildPublicationPlan(validRequest);
  expect(plan.identityKey).toBe("project-1|main|hash-1|proposal");
  expect(plan.files.map((file) => file.path)).toEqual(["knowledge/rule-1.md"]);
});
```

- [ ] **Step 2: Ejecutar pruebas y confirmar el fallo**

Run: `npm test -- tests/publication/publication-plan.test.ts tests/publication/publication-errors.test.ts`

Expected: FAIL porque no existen los contratos de publicación.

- [ ] **Step 3: Implementar tipos, errores y plan determinista**

Definir tipos sin dependencias GitLab. El plan debe usar `corpus.manifest.corpusHash`, ordenar rutas ordinalmente, generar una rama limitada a caracteres seguros y producir `CreateCommitInput` con contenido de los archivos de proyección solo dentro del límite interno. Los errores tendrán códigos `PUBLICATION_INVALID_CORPUS`, `GITLAB_AUTH_REQUIRED`, `GITLAB_FORBIDDEN`, `GITLAB_PROJECT_NOT_ALLOWED`, `BASE_BRANCH_CHANGED`, `PUBLICATION_CONFLICT`, `MR_ALREADY_OPEN`, `APPROVAL_REQUIRED`, `CI_NOT_GREEN` y `GITLAB_UNAVAILABLE`.

- [ ] **Step 4: Ejecutar checks y commit**

Run: `npm test -- tests/publication/publication-plan.test.ts tests/publication/publication-errors.test.ts && npm run typecheck && git diff --check`

Commit:

```bash
git add src/publication tests/publication
git commit -m "feat: add GitLab publication contracts"
```

### Task 2: Implementar FakeGitLabAdapter y PublicationService para propuestas

**Files:**
- Create: `src/publication/fake-gitlab-adapter.ts`
- Create: `src/publication/publication-service.ts`
- Create: `tests/publication/fake-gitlab-adapter.test.ts`
- Create: `tests/publication/publication-service.test.ts`

**Interfaces:**
- `FakeGitLabAdapter implements GitLabPort` y mantiene ramas, commits y MRs en memoria.
- `PublicationService.createProposal(request: PublicationRequest): Promise<PublicationResult>`.
- `PublicationResult` contiene `branchName`, `commitSha`, `mergeRequestIid`, `mergeRequestUrl`, `mergeRequestState`, `ciState`, `fileCount`, `mode` y `outcome`.
- `PublicationService.plan(request): PublicationPlan` no ejecuta mutaciones.

- [ ] **Step 1: Escribir pruebas fallidas del fake y propuesta**

Cubrir creación de rama, commit y MR; reutilización cuando la identidad coincide; conflicto cuando la rama tiene otro SHA; corpus inválido sin llamadas al fake; base branch con SHA diferente; y resultado sin secretos.

```ts
it("reuses an equivalent open MR", async () => {
  const service = new PublicationService(new FakeGitLabAdapter());
  const first = await service.createProposal(validRequest);
  const second = await service.createProposal(validRequest);
  expect(second.mergeRequestIid).toBe(first.mergeRequestIid);
  expect(second.outcome).toBe("proposal-created");
});
```

- [ ] **Step 2: Ejecutar pruebas para confirmar el fallo**

Run: `npm test -- tests/publication/fake-gitlab-adapter.test.ts tests/publication/publication-service.test.ts`

Expected: FAIL porque no existen el fake ni el servicio.

- [ ] **Step 3: Implementar el fake determinista**

Sembrar cada fake con una rama base `main` y SHA conocido. Generar SHA/MR IID deterministas a partir de un contador interno y conservar llamadas sanitizadas para aserciones. Rechazar proyecto desconocido con `GITLAB_PROJECT_NOT_ALLOWED` y no almacenar tokens.

- [ ] **Step 4: Implementar `createProposal`**

Validar `corpus.errors.length === 0`, consultar la rama base, construir el plan, buscar MR abierto por identidad, crear/reutilizar rama, crear commit solo si el contenido cambió y crear/reutilizar MR. Verificar el SHA base inmediatamente antes del commit. Convertir excepciones del puerto a `PublicationError` sin transportar mensajes sensibles.

- [ ] **Step 5: Ejecutar pruebas, formato y commit**

Run: `npm test -- tests/publication/fake-gitlab-adapter.test.ts tests/publication/publication-service.test.ts && npm run typecheck && npx prettier --check src/publication tests/publication`

Commit:

```bash
git add src/publication tests/publication
git commit -m "feat: create idempotent OKF proposal service"
```

### Task 3: Implementar GitLabHttpAdapter con contrato REST seguro

**Files:**
- Create: `src/publication/gitlab-http-adapter.ts`
- Create: `src/publication/gitlab-schemas.ts`
- Create: `tests/publication/gitlab-http-adapter.test.ts`
- Create: `tests/security/publication-sensitive-output.test.ts`
- Modify: `src/config.ts`
- Modify: `tests/config-i3.test.ts`

**Interfaces:**
- `GitLabHttpAdapter(options: { baseUrl: string; token: string; fetcher?: Fetcher }) implements GitLabPort`.
- `gitlabBranchSchema`, `gitlabCommitSchema`, `gitlabMergeRequestSchema` validan únicamente campos necesarios.
- `createRuntimePublicationPort(config): GitLabPort | undefined` devuelve `undefined` si publicación no está explícitamente habilitada.

- [ ] **Step 1: Escribir pruebas fallidas de requests y errores**

Usar un `fetcher` falso que registre URL, método, headers y cuerpo. Probar GET de rama, búsqueda de MR, creación de branch, commit y MR. Afirmar que el token solo está en el header del request y nunca en logs, excepciones o `PublicationResult`. Probar respuestas 401, 403, 404, 409, 429 y 5xx con códigos normalizados.

```ts
it("does not expose the GitLab token in normalized errors", async () => {
  const adapter = new GitLabHttpAdapter({ baseUrl: "https://gitlab.example", token: "secret-token", fetcher: failingFetcher });
  await expect(adapter.getBranch("project-1", "main")).rejects.toMatchObject({ code: "GITLAB_UNAVAILABLE" });
  await expect(adapter.getBranch("project-1", "main")).rejects.not.toThrow("secret-token");
});
```

- [ ] **Step 2: Ejecutar pruebas para confirmar el fallo**

Run: `npm test -- tests/publication/gitlab-http-adapter.test.ts tests/security/publication-sensitive-output.test.ts`

Expected: FAIL porque no existen el adaptador ni los schemas REST.

- [ ] **Step 3: Implementar request común y schemas**

Usar `fetch` con `PRIVATE-TOKEN`, `content-type` solo donde corresponda y timeout mediante `AbortController`. Parsear respuestas con Zod; ante una respuesta inválida devolver `GITLAB_UNAVAILABLE`. No incluir respuesta completa en errores.

- [ ] **Step 4: Implementar operaciones del puerto**

Mapear únicamente endpoints GitLab v4 para rama, commits, merge requests abiertos y estados de aprobación/pipeline. La búsqueda de MR debe filtrar por `source_branch`, `target_branch` y una etiqueta/description marker con la identidad; no buscar por contenido documental.

- [ ] **Step 5: Añadir configuración explícita**

Agregar variables con defaults deshabilitados:

```text
KCP_GITLAB_PUBLICATION_ENABLED=false
KCP_GITLAB_BASE_URL=https://gitlab.example.com
KCP_GITLAB_PROJECT_ID=
KCP_GITLAB_TOKEN=
KCP_GITLAB_BASE_BRANCH=main
KCP_GITLAB_BRANCH_PREFIX=knowledge/proposal
KCP_GITLAB_TIMEOUT_MS=10000
```

Rechazar configuración habilitada sin URL, proyecto, token o rama base. Mantener el token fuera de cualquier objeto serializable de configuración pública.

- [ ] **Step 6: Ejecutar checks y commit**

Run: `npm test -- tests/publication/gitlab-http-adapter.test.ts tests/security/publication-sensitive-output.test.ts tests/config-i3.test.ts && npm run typecheck && npx prettier --check src/publication src/config.ts tests/publication tests/security`

Commit:

```bash
git add src/publication src/config.ts tests/publication tests/security tests/config-i3.test.ts
git commit -m "feat: add secure GitLab HTTP publication adapter"
```

### Task 4: Añadir promoción aprobada y CLI de publicación

**Files:**
- Modify: `src/publication/publication-service.ts`
- Create: `src/ingestion/okf-publication-cli.ts`
- Modify: `package.json`
- Create: `tests/ingestion/okf-publication-cli.test.ts`
- Modify: `tests/publication/publication-service.test.ts`

**Interfaces:**
- `PublicationService.publishApproved(request: PublicationRequest): Promise<PublicationResult>`.
- `parsePublicationArgs(args: readonly string[]): PublicationArgs` con comandos `plan` y `publish`, modos `proposal` y `approved-publish`.
- `runPublicationCommand(environment, args): Promise<number>`.
- Scripts: `okf:publication-plan` y `okf:publish`.

- [ ] **Step 1: Escribir pruebas fallidas de gates aprobados**

Probar que `approved-publish` devuelve `APPROVAL_REQUIRED` si el MR no está aprobado, `CI_NOT_GREEN` si el pipeline no está verde y solo llama al callback `indexApprovedProjection` cuando ambos gates están satisfechos. Probar que `proposal` nunca llama al callback.

```ts
it("does not index a proposal before approval", async () => {
  const result = await service.createProposal(validRequest);
  expect(result.outcome).toBe("proposal-created");
  expect(indexApprovedProjection).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Ejecutar pruebas para confirmar el fallo**

Run: `npm test -- tests/publication/publication-service.test.ts tests/ingestion/okf-publication-cli.test.ts`

Expected: FAIL porque el servicio no tiene gate de aprobación ni CLI.

- [ ] **Step 3: Implementar `publishApproved`**

Consultar gate del MR mediante el puerto, exigir `approved === true` y `ci === "success"`, volver a compilar la revisión aprobada y verificar que todos los documentos proyectados sean `stable`. Invocar el indexador I3 únicamente después de los checks; devolver commit, MR, hash, procedencia y conteos.

- [ ] **Step 4: Implementar parser y CLI**

`plan` solo muestra branch, hash, archivos y operación; `publish --mode proposal` crea/reutiliza MR; `publish --mode approved-publish` exige gates. Aceptar argumentos posicionales porque npm 11 puede eliminar flags desconocidos y no imprimir tokens ni contenido documental.

- [ ] **Step 5: Registrar scripts y probar salida**

Agregar:

```json
{
  "okf:publication-plan": "tsx src/ingestion/okf-publication-cli.ts plan",
  "okf:publish": "tsx src/ingestion/okf-publication-cli.ts publish"
}
```

Run: `npm test -- tests/ingestion/okf-publication-cli.test.ts tests/publication/publication-service.test.ts && npm run typecheck && npx prettier --check src/ingestion/okf-publication-cli.ts src/publication tests/ingestion tests/publication`

- [ ] **Step 6: Commit**

```bash
git add src/publication src/ingestion/okf-publication-cli.ts package.json package-lock.json tests/ingestion tests/publication
git commit -m "feat: gate approved OKF publication"
```

### Task 5: Integrar validación CI y pruebas manuales de publicación

**Files:**
- Modify: `.gitlab-ci.yml` preservando cambios locales existentes
- Create: `scripts/okf-publication-smoke.mjs`
- Create: `docs/manual-tests/08-i4b-gitlab-publication.md`
- Modify: `docs/manual-tests/README.md`
- Create: `tests/integration/i4b-publication.test.ts`

**Interfaces:**
- El job CI `okf-validate` ejecuta `npm run okf:validate -- tests/fixtures/okf-valid stable` y `npm run okf:compile -- tests/fixtures/okf-valid .tmp/i4a-projection stable` sin credenciales GitLab.
- `scripts/okf-publication-smoke.mjs` sale `0` y muestra `SKIP` cuando `KCP_GITLAB_PUBLICATION_INTEGRATION` no es `true`; con integración habilitada nunca imprime el token ni cuerpos completos.
- La prueba de integración offline usa `FakeGitLabAdapter` y comprueba propuesta, idempotencia, conflicto y gate de promoción.

- [ ] **Step 1: Escribir la prueba de aceptación fallida**

Crear casos para propuesta válida, repetición idempotente, corpus inválido sin llamada al puerto, conflicto de branch y promoción bloqueada/liberada por aprobación y CI.

- [ ] **Step 2: Ejecutar prueba para confirmar el fallo**

Run: `npm test -- tests/integration/i4b-publication.test.ts`

Expected: FAIL porque aún no existe la integración final ni el smoke script.

- [ ] **Step 3: Implementar smoke script y job CI**

El smoke script debe validar variables obligatorias solo cuando la integración está habilitada. Modificar `.gitlab-ci.yml` mediante una edición mínima, conservar jobs y reglas existentes, añadir validación/compilación OKF antes de cualquier publicación y no poner tokens en argumentos.

- [ ] **Step 4: Redactar prueba manual**

`08-i4b-gitlab-publication.md` debe cubrir plan offline, propuesta con fake, validación de corpus inválido, configuración protegida para GitLab real, MR duplicado, branch conflictiva, aprobación/CI y limpieza. Las instrucciones no deben pedir copiar tokens ni cuerpos completos.

- [ ] **Step 5: Ejecutar gate final**

Run: `npm test -- tests/publication tests/ingestion/okf-publication-cli.test.ts tests/integration/i4b-publication.test.ts tests/okf && npm run build && npm run typecheck && git diff --check`

Expected: PASS offline; la integración real se marca `SKIP` si no está explícitamente habilitada.

- [ ] **Step 6: Commit**

```bash
git add .gitlab-ci.yml scripts/okf-publication-smoke.mjs docs/manual-tests/08-i4b-gitlab-publication.md docs/manual-tests/README.md tests/integration/i4b-publication.test.ts
git commit -m "test: verify I4-B GitLab publication flow"
```

## Revisión del plan contra la especificación

- Puerto/adaptador y fake offline: Tasks 1–3.
- Plan determinista, rama, commit y MR: Tasks 1–2.
- Idempotencia por proyecto/base/hash/modo: Task 2.
- Conflicto de rama base y branch existente: Tasks 1–2.
- Adaptador REST seguro y errores normalizados: Task 3.
- Propuesta sin promoción estable: Tasks 2 y 4.
- Aprobación y CI verde antes de indexar: Task 4.
- CLI y configuración explícita: Tasks 3–4.
- CI, smoke e instrucciones manuales: Task 5.
- Portal, conectores, Kafka, Vault, OKE y dashboard: explícitamente fuera de alcance.

Plan revisado para consistencia de nombres: `GitLabPort`, `FakeGitLabAdapter`, `GitLabHttpAdapter`, `PublicationService.createProposal`, `PublicationService.publishApproved`, `buildPublicationPlan`, `parsePublicationArgs` y `runPublicationCommand` son las interfaces únicas usadas entre tareas.
