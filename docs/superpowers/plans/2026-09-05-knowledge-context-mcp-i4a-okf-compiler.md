# I4-A Knowledge Compiler OKF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validar un corpus OKF v0.2, aplicar sus reglas de gobierno y producir una proyección determinista que pueda ser indexada por el flujo I3 sin contaminar el índice estable.

**Architecture:** Se añadirá un módulo `src/okf` con parser de frontmatter, esquema, reglas de gobierno, compilador y escritor atómico de proyecciones. La salida será compatible con `FilesystemDocumentSource` para reutilizar canonicalización, chunking, ACL, MySQL y Qdrant de I3; el CLI encadenará `validate`, `compile` e `index` sin duplicar el indexador.

**Tech Stack:** Node.js 22, TypeScript, Zod 4, YAML, Vitest, el CLI `tsx` existente, MySQL 8.4 y Qdrant REST del flujo I3.

**Spec:** `docs/superpowers/specs/2026-09-05-knowledge-context-mcp-i4a-okf-compiler-design.md`

## Global Constraints

- El MCP sigue siendo de lectura; I4-A no agrega herramientas de mutación.
- La ACL y la procedencia existentes en I3 deben conservarse en la proyección.
- No se deben registrar secretos, documentos completos ni contenido sensible en errores o logs.
- El orden de archivos, documentos y chunks será determinista.
- Un corpus inválido no puede producir artefactos publicables ni iniciar indexación.
- Una compilación repetida con la misma entrada debe producir el mismo resultado.
- La publicación mediante Merge Request, CI remoto, conectores, Kafka, portal, Vault y OKE queda fuera de I4-A.
- Cada tarea termina con pruebas enfocadas, typecheck/formato cuando corresponda y un commit separado.

---

### Task 1: Alinear estados y metadatos de gobierno con el dominio I3

**Files:**
- Modify: `src/domain/i3-types.ts`
- Modify: `src/domain/schemas.ts`
- Modify: `src/retrieval/source-document.ts`
- Modify: `src/retrieval/filesystem-document-source.ts`
- Modify: `src/catalog/migrations.ts`
- Modify: `src/catalog/mysql-catalog-writer.ts`
- Modify: `db/migrations/001_i2_catalog.sql`
- Create: `db/migrations/005_i4a_okf_governance.sql`
- Modify: `tests/domain/schemas.test.ts`
- Modify: `tests/retrieval/filesystem-document-source.test.ts`
- Modify: `tests/catalog/i3-migrations.test.ts`
- Modify: `tests/catalog/mysql-catalog-writer.test.ts`

**Interfaces:**
- `KnowledgeStatus` y `knowledgeStatusSchema` aceptan `stale` y conservan `archived` para compatibilidad de datos existentes.
- `SourceDocument` añade `artifactType: string` y `successorKnowledgeId?: string`; `staleAfter` sigue expresando la caducidad temporal.
- La entrada de manifiesto acepta `artifactType` y `successorKnowledgeId` y rechaza campos desconocidos.
- `MySqlCatalogWriter.upsertDocument` persiste `successorKnowledgeId` en `knowledge_artifacts`.

- [ ] **Step 1: Escribir las pruebas fallidas de contrato**

Añadir casos que demuestren que `stale` es un estado válido, que un documento conserva `successorKnowledgeId`, que `artifactType` es obligatorio en la proyección y que un manifiesto con campos desconocidos falla con un error de esquema.

```ts
it("accepts stale and successor metadata", () => {
  expect(knowledgeStatusSchema.parse("stale")).toBe("stale");
  expect(manifestDocumentSchema.parse(validManifestEntry).successorKnowledgeId)
    .toBe("replacement-rule");
});
```

- [ ] **Step 2: Ejecutar las pruebas para confirmar el fallo**

Run: `npm test -- tests/domain/schemas.test.ts tests/retrieval/filesystem-document-source.test.ts`

Expected: FAIL porque `stale`, `artifactType` y `successorKnowledgeId` todavía no forman parte de los contratos actuales.

- [ ] **Step 3: Implementar los tipos y esquemas mínimos**

Extender los tipos existentes sin crear un segundo modelo de documento. Mantener `archived` para no invalidar filas históricas, agregar `stale` al enum compartido y validar `artifactType` con un identificador no vacío. Mantener `successorKnowledgeId` opcional para todos los estados y requerirlo después en la regla específica de `superseded`.

- [ ] **Step 4: Crear la migración compatible y actualizar el escritor**

Crear `005_i4a_okf_governance.sql` con una modificación idempotente de `knowledge_artifacts.current_status` para incluir `stale`. Actualizar la lista de migraciones TypeScript y el SQL histórico `001_i2_catalog.sql` para que una instalación nueva tenga el mismo enum. Añadir `successor_knowledge_id` al `INSERT ... ON DUPLICATE KEY UPDATE` del escritor y usar parámetros, nunca interpolación.

- [ ] **Step 5: Ejecutar pruebas y commit**

Run: `npm test -- tests/domain/schemas.test.ts tests/retrieval/filesystem-document-source.test.ts tests/catalog/i3-migrations.test.ts tests/catalog/mysql-catalog-writer.test.ts && npm run typecheck && npm run format:check`

Commit:

```bash
git add src/domain src/retrieval/source-document.ts src/retrieval/filesystem-document-source.ts src/catalog/migrations.ts src/catalog/mysql-catalog-writer.ts db/migrations tests/domain/schemas.test.ts tests/retrieval/filesystem-document-source.test.ts tests/catalog/i3-migrations.test.ts tests/catalog/mysql-catalog-writer.test.ts
git commit -m "feat: align I3 metadata with OKF governance"
```

### Task 2: Implement parser, frontmatter schema y reglas de gobierno OKF

**Files:**
- Create: `src/okf/okf-types.ts`
- Create: `src/okf/frontmatter-parser.ts`
- Create: `src/okf/okf-schema.ts`
- Create: `src/okf/governance.ts`
- Create: `tests/okf/frontmatter-parser.test.ts`
- Create: `tests/okf/governance.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- `parseOkfMarkdown(source: string, filename: string): ParsedOkfMarkdown` devuelve `{ frontmatter, content }` y nunca devuelve contenido parcial cuando el frontmatter es inválido.
- `okfDocumentSchema` valida `OkfFrontmatter` con `knowledgeId`, `title`, `artifactType`, `sourceUri`, `sourceRevision`, `product`, `domain`, `classification`, `status`, `owner`, `evidence`, `acl`, `relations`, `verifiedAt` y `staleAfter`.
- `validateGovernance(document: OkfDocument, corpusIds: ReadonlySet<string>): GovernanceIssue[]` devuelve errores con `{ code, file, field, message }` sin incluir el cuerpo Markdown.
- `toSourceDocument(document: ValidatedOkfDocument): SourceDocument` produce el contrato que consume I3.

- [ ] **Step 1: Añadir el parser de frontmatter como prueba fallida**

Crear pruebas para delimitadores `---`, YAML válido, cuerpo Markdown preservado byte a byte, delimitador ausente, YAML malformado y frontmatter que contiene una clave desconocida.

```ts
it("separates YAML frontmatter from Markdown body", () => {
  const parsed = parseOkfMarkdown("---\\nknowledgeId: rule-1\\n---\\n# Rule\\n", "rule.md");
  expect(parsed.content).toBe("# Rule\\n");
  expect(parsed.frontmatter.knowledgeId).toBe("rule-1");
});
```

- [ ] **Step 2: Ejecutar el foco para confirmar el fallo**

Run: `npm test -- tests/okf/frontmatter-parser.test.ts`

Expected: FAIL porque no existe `src/okf/frontmatter-parser.ts` ni la dependencia YAML.

- [ ] **Step 3: Implementar el parser y agregar la dependencia YAML**

Usar la librería `yaml` con un documento estricto, exigir que el primer bloque sea frontmatter y devolver errores con nombre de archivo y línea. No imprimir el cuerpo de entrada en ningún error. Agregar el paquete con `npm install yaml` y conservar el lockfile.

- [ ] **Step 4: Escribir pruebas fallidas del esquema y gobierno**

Cubrir al menos: estado no soportado; `stable` sin `owner`, `evidence`, `verifiedAt` o ACL; `superseded` sin `relations.supersededBy`; `supersededBy` inexistente; fecha `staleAfter` malformada; `staleAfter` anterior a `verifiedAt`; fuente no URL; ID duplicado; y documento válido para cada estado permitido.

```ts
it("requires a successor for superseded documents", () => {
  const result = validateGovernance({ ...validDocument, status: "superseded", relations: {} }, new Set([validDocument.knowledgeId]));
  expect(result.map((issue) => issue.code)).toContain("SUPERSEDED_SUCCESSOR_REQUIRED");
});
```

- [ ] **Step 5: Implementar esquema, reglas y mapeo a I3**

Usar Zod para tipos y campos desconocidos. La regla `stable` exigirá propietario, al menos una evidencia, `verifiedAt` y una ACL explícita. La regla de relaciones comprobará IDs del corpus, prohibirá autorreferencias y exigirá sucesor para `superseded`. Un documento con `staleAfter` vencido se clasificará como `stale` en la proyección; no se cambiará la fuente original. `toSourceDocument` mapeará `sourceSystem: "okf"`, locator de sección y todos los campos de ACL/procedencia.

- [ ] **Step 6: Ejecutar pruebas y commit**

Run: `npm test -- tests/okf/frontmatter-parser.test.ts tests/okf/governance.test.ts && npm run typecheck && npm run format:check`

Commit:

```bash
git add src/okf package.json package-lock.json tests/okf
git commit -m "feat: validate OKF frontmatter and governance"
```

### Task 3: Construir el compilador determinista y la proyección compatible con I3

**Files:**
- Create: `src/okf/corpus-reader.ts`
- Create: `src/okf/compiler.ts`
- Create: `src/okf/projection-writer.ts`
- Create: `tests/okf/compiler.test.ts`
- Create: `tests/okf/projection-writer.test.ts`
- Create: `tests/fixtures/okf-valid/`
- Create: `tests/fixtures/okf-invalid/`

**Interfaces:**
- `compileOkfCorpus(inputDir: string, options: CompileOptions): Promise<CompiledCorpus>`.
- `CompiledCorpus` contiene `manifest: ProjectionManifest`, `documents: readonly SourceDocument[]`, `errors: readonly GovernanceIssue[]` y `warnings: readonly GovernanceIssue[]`.
- `writeProjection(corpus: CompiledCorpus, outputDir: string): Promise<ProjectionManifest>` escribe `manifest.json` y documentos normalizados bajo `documents/` de forma atómica.
- `ProjectionManifest` contiene `contractVersion`, `corpusHash`, `documents`, `counts`, `errors` y `warnings`; no contiene timestamps variables.

- [ ] **Step 1: Escribir pruebas fallidas de lectura y determinismo**

Crear fixtures con dos documentos válidos, un documento `draft`, uno vencido y uno superseded. Probar que la lectura recursiva ordena rutas por comparación ordinal, ignora solo el directorio de salida, detecta IDs duplicados y calcula el mismo `corpusHash` para dos ejecuciones.

```ts
it("compiles the same corpus to the same hash and order", async () => {
  const first = await compileOkfCorpus("tests/fixtures/okf-valid", { mode: "stable" });
  const second = await compileOkfCorpus("tests/fixtures/okf-valid", { mode: "stable" });
  expect(second.manifest).toEqual(first.manifest);
  expect(second.manifest.corpusHash).toBe(first.manifest.corpusHash);
});
```

- [ ] **Step 2: Ejecutar pruebas para confirmar el fallo**

Run: `npm test -- tests/okf/compiler.test.ts tests/okf/projection-writer.test.ts`

Expected: FAIL porque no existen el lector, el compilador ni el escritor de proyección.

- [ ] **Step 3: Implementar la lectura y compilación en memoria**

Recorrer únicamente archivos `.md`, leerlos como UTF-8, ordenar las rutas, parsear frontmatter, validar documentos y resolver relaciones después de cargar todos los IDs. Calcular el hash con una secuencia ordenada de `ruta relativa`, `contentHash` y metadatos canónicos, sin hora actual. En modo `stable`, convertir documentos vencidos a `stale` y excluir de `documents` los estados que no son indexables estables; en modo `draft`, conservarlos en el reporte pero marcarlos no estables.

- [ ] **Step 4: Implementar la proyección compatible con `FilesystemDocumentSource`**

Escribir primero en un directorio temporal hermano del destino. Emitir `manifest.json` con rutas relativas `documents/<knowledgeId>.md`, copiar el contenido normalizado sin frontmatter y publicar con rename atómico solo después de escribir todos los archivos. Ante cualquier error, eliminar únicamente el temporal y dejar intacto el destino previo. El manifiesto final debe satisfacer el esquema que consume `FilesystemDocumentSource`.

- [ ] **Step 5: Probar errores, artefactos y compatibilidad I3**

Verificar que un corpus inválido devuelve errores por archivo/campo sin el cuerpo completo, no crea `manifest.json`, no inicia el indexador y no altera un destino existente. Cargar el manifiesto generado con `FilesystemDocumentSource` y comprobar que sus documentos pasan por `canonicalizeDocument` y `chunkDocument` con IDs y localizadores reproducibles.

- [ ] **Step 6: Ejecutar pruebas y commit**

Run: `npm test -- tests/okf/compiler.test.ts tests/okf/projection-writer.test.ts tests/retrieval/filesystem-document-source.test.ts tests/retrieval/canonicalizer.test.ts tests/retrieval/chunker.test.ts && npm run typecheck && npm run format:check`

Commit:

```bash
git add src/okf tests/okf tests/fixtures/okf-valid tests/fixtures/okf-invalid
git commit -m "feat: compile OKF into deterministic I3 projections"
```

### Task 4: Persist successor y artifact metadata sin romper la recuperación

**Files:**
- Modify: `src/catalog/mysql-catalog-writer.ts`
- Modify: `src/catalog/mysql-repository.ts`
- Modify: `src/catalog/mysql-row-mappers.ts`
- Modify: `src/catalog/memory-repository.ts`
- Modify: `src/retrieval/ingestion-indexer.ts`
- Modify: `src/retrieval/qdrant-vector-store.ts`
- Modify: `src/retrieval/vector-filters.ts`
- Modify: `tests/catalog/mysql-repository.test.ts`
- Modify: `tests/catalog/memory-repository.test.ts`
- Modify: `tests/retrieval/vector-filters.test.ts`
- Modify: `tests/retrieval/ingestion-indexer.test.ts`

**Interfaces:**
- Las consultas de MySQL y Qdrant aceptan `stale` como estado y mantienen por defecto la exclusión de documentos vencidos.
- `knowledgeArtifactSchema` conserva `successorKnowledgeId` al hidratar resultados.
- Los puntos Qdrant incluyen solo `knowledgeId`, revisión, estado, scope, ACL derivada y `stale`; nunca evidencia textual, JWT ni secretos.

- [ ] **Step 1: Escribir regresiones fallidas**

Añadir pruebas que exijan sucesor en la fila hidratada, filtren `status: ["stale"]`, excluyan `stale` de una búsqueda normal y mantengan el sucesor al consultar lineage. Añadir una prueba del indexador que verifique que el payload conserva el estado compilado.

- [ ] **Step 2: Ejecutar las pruebas para confirmar la regresión**

Run: `npm test -- tests/catalog/mysql-repository.test.ts tests/catalog/memory-repository.test.ts tests/retrieval/vector-filters.test.ts tests/retrieval/ingestion-indexer.test.ts`

Expected: FAIL porque el mapeo SQL, los filtros y los payloads actuales no cubren completamente los metadatos del compilador.

- [ ] **Step 3: Implementar el mínimo cambio de persistencia y filtros**

Incluir `successor_knowledge_id` en los SELECT/mappers y en el repositorio en memoria. Agregar `stale` al filtro compartido y tratar un `staleAfter` vencido como no vigente por defecto. Mantener las comprobaciones ACL existentes antes de devolver filas o candidatos vectoriales.

- [ ] **Step 4: Ejecutar pruebas y revisar salida sensible**

Run: `npm test -- tests/catalog/mysql-repository.test.ts tests/catalog/memory-repository.test.ts tests/retrieval/vector-filters.test.ts tests/retrieval/ingestion-indexer.test.ts tests/security/i3-sensitive-output.test.ts`

Expected: PASS; los SQL siguen parametrizados y los payloads no contienen texto completo ni metadatos de autenticación.

- [ ] **Step 5: Commit**

```bash
git add src/catalog src/retrieval tests/catalog tests/retrieval tests/security/i3-sensitive-output.test.ts
git commit -m "feat: preserve OKF governance metadata during retrieval"
```

### Task 5: Añadir CLI `okf:validate`, `okf:compile` y `okf:index`

**Files:**
- Create: `src/ingestion/okf-cli.ts`
- Modify: `src/ingestion/i3-cli.ts`
- Modify: `package.json`
- Create: `tests/ingestion/okf-cli.test.ts`
- Modify: `tests/config-i3.test.ts`

**Interfaces:**
- `parseOkfArgs(args: readonly string[]): { command: "validate" | "compile" | "index"; sourceDir: string; outputDir: string; mode: "draft" | "stable" }`.
- `runOkfCommand(environment: Record<string, string | undefined>, args: readonly string[]): Promise<number>`.
- Scripts: `npm run okf:validate -- <sourceDir>`, `npm run okf:compile -- <sourceDir> <outputDir>`, `npm run okf:index -- <sourceDir> <outputDir>`.

- [ ] **Step 1: Escribir pruebas fallidas del contrato CLI**

Cubrir comando requerido, directorio posicional y flags `--source-dir`, `--output-dir`, `--mode`; validar que `validate` imprime un resumen seguro y devuelve `1` ante errores, que `compile` escribe solo corpus válido y que `index` no crea runtime si la compilación falla.

```ts
it("accepts positional source and explicit stable mode", () => {
  expect(parseOkfArgs(["compile", "fixtures/okf", "out", "--mode", "stable"])).toEqual({
    command: "compile", sourceDir: "fixtures/okf", outputDir: "out", mode: "stable",
  });
});
```

- [ ] **Step 2: Ejecutar las pruebas para confirmar el fallo**

Run: `npm test -- tests/ingestion/okf-cli.test.ts`

Expected: FAIL porque no existe el parser de argumentos ni el CLI OKF.

- [ ] **Step 3: Implementar el parser y los comandos sin efectos parciales**

Implementar los tres comandos sobre `compileOkfCorpus` y `writeProjection`. `validate` no escribe; `compile` escribe la proyección; `index` compila a un directorio temporal/proyección y después invoca `runI3Indexing` con el directorio generado. Reutilizar `resolveI3SourceDirectory` para aceptar flags y posiciones, devolver códigos `0`/`1`/`2` y limitar el resumen a conteos, códigos y rutas.

- [ ] **Step 4: Registrar scripts y probar integración offline**

Agregar los scripts de `package.json`, ejecutar el CLI contra fixtures usando fakes de dependencias y verificar que la segunda ejecución conserva el resultado idempotente. Mantener `i3:index` sin cambios funcionales para evitar regresión.

- [ ] **Step 5: Ejecutar checks y commit**

Run: `npm test -- tests/ingestion/okf-cli.test.ts tests/ingestion/i3-cli.test.ts tests/config-i3.test.ts && npm run typecheck && npm run format:check`

Commit:

```bash
git add src/ingestion package.json package-lock.json tests/ingestion tests/config-i3.test.ts
git commit -m "feat: add OKF validation and indexing CLI"
```

### Task 6: Verificar la vertical completa y documentar la prueba manual

**Files:**
- Create: `docs/manual-tests/I4-A-OKF-COMPILER.md`
- Create: `tests/integration/i4a-okf-indexing.test.ts`
- Modify: `README.md` only in the I4 status/usage section

**Interfaces:**
- La prueba de integración usa fixtures compilados y dobles de `CatalogWriter`/`VectorStore` para demostrar que un corpus válido indexa y un corpus inválido no modifica estado.
- La prueba manual usa exclusivamente comandos existentes del proyecto y documenta resultados esperados, limpieza segura y diagnóstico de errores.

- [ ] **Step 1: Escribir la prueba de aceptación fallida**

Crear un caso que compile un corpus con `stable`, `draft`, `stale` y `superseded`, cargue la proyección con `FilesystemDocumentSource`, ejecute `IngestionIndexer` dos veces y compruebe `processed > 0` en la primera ejecución y `skipped === processed` en la segunda. Crear otro caso que confirme que el corpus inválido no llama al indexador.

- [ ] **Step 2: Ejecutar la prueba para confirmar el fallo**

Run: `npm test -- tests/integration/i4a-okf-indexing.test.ts`

Expected: FAIL hasta que el compilador, la proyección y el CLI estén conectados a las interfaces I3.

- [ ] **Step 3: Implementar la prueba y el documento manual**

El documento `I4-A-OKF-COMPILER.md` debe incluir prerrequisitos, comandos PowerShell, corpus temporal, validación, compilación, inspección de `manifest.json`, indexación local, repetición idempotente, verificación de estado y limpieza limitada al directorio temporal creado por la prueba. Debe registrar respuestas esperadas y criterios PASS/FAIL.

Comandos mínimos documentados:

```powershell
npm test -- tests/okf tests/integration/i4a-okf-indexing.test.ts
npm run okf:validate -- tests/fixtures/okf-valid --mode stable
npm run okf:compile -- tests/fixtures/okf-valid .tmp/i4a-projection --mode stable
npm run okf:index -- tests/fixtures/okf-valid .tmp/i4a-projection --mode stable
```

- [ ] **Step 4: Ejecutar la vertical y checks finales**

Run: `npm test -- tests/okf tests/integration/i4a-okf-indexing.test.ts tests/retrieval tests/catalog tests/mcp && npm run typecheck && npm run format:check && npm run build`

Expected: PASS sin exigir MySQL, Qdrant, Keycloak ni servicios externos para las pruebas unitarias; la integración opcional existente conserva su guardia de entorno.

- [ ] **Step 5: Actualizar documentación y commit**

Actualizar solo la sección de estado/uso de I4 en `README.md`, sin eliminar la explicación histórica de I3. Ejecutar `git diff --check`, revisar que no aparezcan archivos temporales ni secretos y crear el commit final:

```bash
git add docs/manual-tests/I4-A-OKF-COMPILER.md tests/integration/i4a-okf-indexing.test.ts README.md
git commit -m "test: verify I4-A OKF compiler vertical"
```

## Orden de ejecución y puntos de revisión

1. Ejecutar Tasks 1–2 para fijar contratos y reglas antes de generar artefactos.
2. Revisar la salida de Task 3 antes de conectar el CLI: el manifiesto debe cargar con `FilesystemDocumentSource` sin adaptadores especiales.
3. Ejecutar Task 4 antes de habilitar indexación real para evitar perder sucesores o estados.
4. Ejecutar Task 5 en modo offline; solo después usar dependencias MySQL/Qdrant de la prueba manual.
5. Task 6 es el gate de aceptación de I4-A y debe dejar evidencia reproducible.

## Revisión del plan contra la especificación

- Entrada OKF, frontmatter, fuentes, ACL, fechas y relaciones: Tasks 2–3.
- Reglas `draft`, `stable`, `stale`, `deprecated` y `superseded`: Tasks 1–3.
- Manifiesto y chunks deterministas: Task 3.
- Bloqueo previo a indexación y compatibilidad I3: Tasks 3, 5 y 6.
- Procedencia, ACL, sucesor y filtros de recuperación: Tasks 1 y 4.
- CLI `validate`, `compile`, `index`: Task 5.
- Pruebas unitarias, contrato, regresión e integración: Tasks 2–6.
- Prueba manual y criterios de aceptación: Task 6.
- MR, CI remoto, conectores, portal, Kafka, Vault, OKE y observabilidad distribuida: explícitamente fuera de alcance de I4-A.

Plan revisado para consistencia de nombres: `compileOkfCorpus`, `writeProjection`, `parseOkfMarkdown`, `validateGovernance`, `toSourceDocument`, `parseOkfArgs` y `runOkfCommand` son las interfaces únicas usadas entre tareas.
