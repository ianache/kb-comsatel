# I5-D Golden Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir un arnés offline que ejecute 30 preguntas de oro contra el `ContextEngine`, valide evidencia/citas/ACL/determinismo y emita reportes JSON/Markdown seguros con umbrales de aceptación.

**Architecture:** El dataset JSON versionado se carga y valida mediante un módulo de contratos; un `GoldenEvaluationRunner` recibe un `ContextEngine` y ejecuta cada caso contra el API público del motor. Un módulo separado agrega métricas y redacta reportes, mientras el CLI conecta fixtures deterministas, escribe salidas y devuelve código no exitoso cuando el dataset o los umbrales fallan. No se agregan dependencias ni llamadas de red.

**Tech Stack:** TypeScript/Node.js 22, Zod 4, Vitest, `tsx`, repositorio en memoria y `MemoryAuditSink` existentes.

**Spec:** `docs/superpowers/specs/2026-09-05-i5d-golden-evaluation-design.md`

## Global Constraints

- El runner debe soportar únicamente `search_knowledge`, `build_context_pack` y `get_task_context`.
- El dataset inicial debe contener exactamente 30 casos y el runner debe marcar incompleto cualquier ejecución con menos de 30.
- Las respuestas con evidencia deben contener citas; las respuestas sin evidencia deben declarar `evidenceStatus: "insufficient"`.
- Las pruebas no requieren MySQL, Qdrant, GitLab, Google Drive, Keycloak ni credenciales.
- Los reportes estándar no deben incluir preguntas completas, tareas, extractos, cuerpos documentales, tokens, headers ni secretos.
- No cambiar los siete nombres de herramientas MCP ni introducir operaciones mutantes.
- Cada tarea sigue TDD: escribir prueba, observar fallo esperado, implementar mínimo, observar verde y hacer commit.

## File Map

- Create `src/evaluation/golden-types.ts`: contratos Zod/TypeScript para casos, expectativas, resultados y reporte.
- Create `src/evaluation/golden-runner.ts`: ejecución de casos contra `ContextEngine` y validaciones públicas.
- Create `src/evaluation/golden-report.ts`: agregación de métricas y serialización segura JSON/Markdown.
- Create `src/evaluation/golden-dataset.ts`: carga, validación y vocabulario de tags del dataset.
- Create `src/evaluation/golden-cli.ts`: CLI `eval` con dataset/salida opcionales, fixtures deterministas y exit code.
- Create `tests/evaluation/golden-types.test.ts`: validación de contratos/dataset.
- Create `tests/evaluation/golden-runner.test.ts`: ejecución y expectativas por caso.
- Create `tests/evaluation/golden-report.test.ts`: métricas, umbrales y redacción.
- Create `tests/evaluation/golden-cli.test.ts`: comportamiento del CLI y códigos de salida.
- Create `tests/fixtures/golden/golden-cases.json`: 30 casos de evaluación seguros.
- Create `docs/manual-tests/12-i5d-golden-evaluation.md`: procedimiento PowerShell, resultados esperados y limpieza.
- Modify `package.json`: script `eval:golden`.
- Modify `docs/manual-tests/README.md`: índice del nuevo manual.

### Task 1: Definir contratos y cargar el dataset

**Files:**
- Create: `src/evaluation/golden-types.ts`
- Create: `src/evaluation/golden-dataset.ts`
- Create: `tests/evaluation/golden-types.test.ts`
- Create: `tests/fixtures/golden/golden-cases.json`

**Interfaces:**
- Produce `goldenCaseSchema`, `goldenDatasetSchema`, `GoldenEvaluationCase`, `GoldenEvaluationDataset`, `GoldenCaseResult`, `GoldenEvaluationReport`.
- Produce `loadGoldenDataset(path: string): Promise<GoldenEvaluationDataset>`.
- `GoldenEvaluationCase.tool` is the union `"search_knowledge" | "build_context_pack" | "get_task_context"`.
- `expectations` contains `evidenceStatus`, optional `minCitations`, `requiredKnowledgeIds`, `forbiddenKnowledgeIds`, `expectedWarning`.

- [ ] **Step 1: Escribir las pruebas que deben fallar**

  Cubrir: un caso válido; rechazo de herramienta desconocida; rechazo de input que no es objeto; rechazo de tags fuera del vocabulario (`evidence`, `insufficient`, `acl-negative`, `stale`, `deterministic`); rechazo de `golden-cases.json` con menos de 30 casos; rechazo de IDs duplicados.

- [ ] **Step 2: Ejecutar las pruebas y verificar el fallo RED**

  Run: `npm test -- tests/evaluation/golden-types.test.ts`

  Expected: FAIL porque aún no existen los contratos ni el loader.

- [ ] **Step 3: Implementar contratos, loader y dataset seguro**

  Usar Zod estricto. El loader debe leer UTF-8, parsear JSON, validar el dataset completo, verificar IDs únicos y exigir exactamente 30 casos. Los inputs de ejemplo deben usar solo datos de `tests/fixtures/okf-valid` y principals sintéticos; ningún caso debe contener token, URL privada o texto documental completo.

- [ ] **Step 4: Ejecutar pruebas y verificar GREEN**

  Run: `npm test -- tests/evaluation/golden-types.test.ts`

  Expected: PASS con validaciones de contrato, tags, cardinalidad e IDs duplicados.

- [ ] **Step 5: Commit**

  ```powershell
  git add src/evaluation/golden-types.ts src/evaluation/golden-dataset.ts tests/evaluation/golden-types.test.ts tests/fixtures/golden/golden-cases.json
  git commit -m "feat: define golden evaluation dataset contracts"
  ```

### Task 2: Ejecutar casos contra el ContextEngine

**Files:**
- Create: `src/evaluation/golden-runner.ts`
- Create: `tests/evaluation/golden-runner.test.ts`

**Interfaces:**
- Consume `ContextEngine`, `AccessPrincipal`, `MemoryAuditSink` y los contratos de Task 1.
- Produce `GoldenEvaluationRunner` con `run(dataset): Promise<GoldenCaseResult[]>`.
- Cada `GoldenCaseResult` contiene `caseId`, `status: "passed" | "failed"`, `failureCodes`, `latencyMs`, `citationCount`, `evidenceStatus`, `knowledgeIds`, `warnings` y `repeatable`.

- [ ] **Step 1: Escribir pruebas RED para las validaciones públicas**

  Crear un `MemoryKnowledgeRepository` con un resultado estable, uno stale/draft y uno restringido. Probar: `search_knowledge` con cita mínima; `build_context_pack` con token budget; `get_task_context` con identificador `!123`; caso `insufficient`; caso `acl-negative`; expectativa de knowledge ID requerido/prohibido; y repetición de un caso sin cambiar la salida.

- [ ] **Step 2: Ejecutar pruebas RED**

  Run: `npm test -- tests/evaluation/golden-runner.test.ts`

  Expected: FAIL porque no existe `GoldenEvaluationRunner`.

- [ ] **Step 3: Implementar el runner mínimo**

  Medir latencia con `performance.now()`. Invocar únicamente los métodos públicos del motor según `tool`. Comparar `evidenceStatus`, conteo de citas, IDs requeridos/prohibidos y warning esperado. Capturar excepciones como `UNEXPECTED_ERROR` sin incluir el mensaje original. Para casos con tag `deterministic`, ejecutar dos veces y comparar solo campos públicos normalizados, excluyendo latencia y valores de correlación.

- [ ] **Step 4: Ejecutar pruebas GREEN y regresión focalizada**

  Run: `npm test -- tests/evaluation/golden-runner.test.ts tests/engine/context-engine.test.ts`

  Expected: PASS; el runner no expone extractos ni cuerpos en `GoldenCaseResult`.

- [ ] **Step 5: Commit**

  ```powershell
  git add src/evaluation/golden-runner.ts tests/evaluation/golden-runner.test.ts
  git commit -m "feat: run golden cases against context engine"
  ```

### Task 3: Agregar métricas y reportes seguros

**Files:**
- Create: `src/evaluation/golden-report.ts`
- Create: `tests/evaluation/golden-report.test.ts`

**Interfaces:**
- Consume `GoldenCaseResult[]` y la cardinalidad del dataset.
- Produce `buildGoldenReport(results, options): GoldenEvaluationReport`.
- Produce `renderGoldenJson(report): string` y `renderGoldenMarkdown(report): string`.
- `GoldenEvaluationReport` incluye `datasetSize`, `executed`, `passed`, `failed`, `complete`, `thresholds`, `metrics`, `failures` y `generatedAt`.

- [ ] **Step 1: Escribir pruebas RED para agregación y redacción**

  Verificar conteos, media/p95 de latencia, cobertura de citas, proporción `insufficient`, ACL, determinismo, reporte incompleto con menos de 30, umbral de 90%, y que JSON/Markdown no contengan la tarea, excerpt, token, Authorization ni secreto de los resultados de prueba.

- [ ] **Step 2: Ejecutar pruebas RED**

  Run: `npm test -- tests/evaluation/golden-report.test.ts`

  Expected: FAIL porque no existe el agregador/renderizador.

- [ ] **Step 3: Implementar métricas y renderizadores**

  Calcular p95 por interpolación determinista sobre latencias ordenadas; usar `0` para un conjunto vacío. El reporte solo copiará IDs, tags, códigos, conteos y latencias. Los umbrales deben ser constantes explícitas: dataset mínimo 30, evidencia/cita 0.90, insufficient 1.00, ACL negativa 1.00 y determinismo 1.00. `complete` será falso si `datasetSize < 30` o cualquier umbral falla.

- [ ] **Step 4: Ejecutar pruebas GREEN**

  Run: `npm test -- tests/evaluation/golden-report.test.ts`

  Expected: PASS y snapshots/asserções confirman que el reporte es seguro.

- [ ] **Step 5: Commit**

  ```powershell
  git add src/evaluation/golden-report.ts tests/evaluation/golden-report.test.ts
  git commit -m "feat: aggregate safe golden evaluation reports"
  ```

### Task 4: Conectar CLI, fixtures y manual test

**Files:**
- Create: `src/evaluation/golden-cli.ts`
- Create: `tests/evaluation/golden-cli.test.ts`
- Create: `docs/manual-tests/12-i5d-golden-evaluation.md`
- Modify: `package.json`
- Modify: `docs/manual-tests/README.md`

**Interfaces:**
- CLI: `tsx src/evaluation/golden-cli.ts eval [datasetPath] [outputDir]`.
- Default dataset: `tests/fixtures/golden/golden-cases.json`.
- Default output: `.tmp/i5d-golden-evaluation`.
- Exit `0` solo cuando el reporte es completo y `complete === true`; exit `1` para fallo de umbral/dataset; exit `2` para argumentos o errores de configuración.

- [ ] **Step 1: Escribir pruebas RED del CLI**

  Probar que el script usa defaults, genera `report.json` y `report.md`, no imprime preguntas/extractos, retorna `0` con fixtures válidos y retorna `1` cuando se ejecuta un dataset reducido o con una expectativa incompatible.

- [ ] **Step 2: Ejecutar pruebas RED**

  Run: `npm test -- tests/evaluation/golden-cli.test.ts`

  Expected: FAIL porque no existe el CLI ni el script `eval:golden`.

- [ ] **Step 3: Implementar CLI y conexión offline**

  Crear el `MemoryKnowledgeRepository`/`ContextEngine` con los fixtures existentes y principals sintéticos. No leer variables de conexión ni instanciar adaptadores HTTP. Usar `fs/promises` para crear solo el output solicitado. Añadir en `package.json`: `"eval:golden": "tsx src/evaluation/golden-cli.ts eval"`.

- [ ] **Step 4: Documentar prueba manual y actualizar índice**

  El manual debe incluir prerrequisitos, comandos PowerShell, ejecución con defaults, inspección de métricas seguras, caso de dataset reducido, criterios PASS/FAIL y limpieza limitada a `.tmp/i5d-golden-evaluation`. Añadir `12-i5d-golden-evaluation.md` al índice, sin pedir tokens ni servicios externos.

- [ ] **Step 5: Ejecutar pruebas GREEN y manual automatizable**

  Run: `npm test -- tests/evaluation/golden-cli.test.ts`

  Run: `npm run eval:golden`

  Expected: exit `0`, `executed=30`, reporte completo y dos archivos bajo `.tmp/i5d-golden-evaluation`; el stdout contiene solo resumen agregado.

- [ ] **Step 6: Commit**

  ```powershell
  git add src/evaluation/golden-cli.ts tests/evaluation/golden-cli.test.ts package.json docs/manual-tests/12-i5d-golden-evaluation.md docs/manual-tests/README.md
  git commit -m "feat: add offline golden evaluation CLI"
  ```

### Task 5: Verificación integrada y cierre de I5-D

**Files:**
- Modify: `.gitlab-ci.yml` only if the repository's existing validation job has a dedicated script list and can invoke the offline command without changing CI secrets.

- [ ] **Step 1: Ejecutar suite focalizada completa**

  Run: `npm test -- tests/evaluation tests/mcp tests/engine/context-engine.test.ts tests/domain/schemas.test.ts`

  Expected: todos los tests de evaluación y regresión focalizada pasan.

- [ ] **Step 2: Ejecutar validaciones del proyecto**

  Run: `npm run build`

  Run: `npm run typecheck`

  Run: `npm run smoke`

  Run: `git diff --check`

  Expected: exit `0` en cada comando; smoke conserva siete tools y tres resource templates.

- [ ] **Step 3: Ejecutar el manual y revisar seguridad del reporte**

  Run: `npm run eval:golden`

  Run: `Select-String -Path .tmp/i5d-golden-evaluation/report.json -Pattern 'Authorization|Bearer|secret|token|excerpt|task'`

  Expected: el primer comando termina `0`; el segundo no encuentra valores sensibles ni contenido documental.

- [ ] **Step 4: Ejecutar Graphify sobre el worktree actualizado**

  Run: `python -m graphify update .`

  Expected: `graphify-out` se actualiza sin modificar código funcional ni introducir artefactos del reporte temporal.

- [ ] **Step 5: Commit de ajustes finales y revisión de estado**

  ```powershell
  git status --short --branch
  git diff --check
  git log --oneline -5
  ```

  Si la verificación requiere cambios documentales o de CI, crear un commit final descriptivo; no incluir cambios locales de I5-B provenientes de `main`.

## Self-Review Checklist

- [ ] La Task 1 cubre contrato, vocabulario, dataset válido de 30 e IDs únicos.
- [ ] La Task 2 cubre las tres herramientas, citas, insufficient, ACL y determinismo.
- [ ] La Task 3 cubre todas las métricas, umbrales, p95 y redacción segura.
- [ ] La Task 4 cubre CLI, exit codes, outputs, manual test e índice.
- [ ] La Task 5 cubre build, typecheck, smoke, diff check y Graphify.
- [ ] No se agregan observabilidad de producción ni hardening de I5-E.
- [ ] No hay placeholders ni funciones referenciadas sin firma en tareas posteriores.
