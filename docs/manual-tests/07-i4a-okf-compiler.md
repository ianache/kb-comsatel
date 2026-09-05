# 07 - I4-A Knowledge Compiler OKF

## Objetivo

Validar manualmente que un corpus OKF v0.2 se valida, compila en una proyección determinista y puede alimentar la ingesta I3 sin indexar documentos `draft`, `stale`, `deprecated` o `superseded` como conocimiento estable.

## Precondiciones

1. Node.js 22 y npm disponibles.
2. Ejecutar los comandos desde la raíz del repositorio.
3. Ejecutar `npm ci` y `npm run build`.
4. Los casos 01–03 no requieren MySQL, Qdrant ni Keycloak.
5. Para el caso 04 se requieren MySQL y Qdrant configurados como en `06-i3-ingestion-indexing.md`.
6. No registrar contraseñas, API keys, JWT completos ni contenido documental completo.

## Casos

### I4A-OKF-01 - validación de corpus válido

```powershell
npm run okf:validate -- tests/fixtures/okf-valid --mode stable
```

Esperado:

- código de salida `0`;
- resumen con `discovered: 2`, `valid: 2`, `indexable: 1` y `errors: 0`;
- `draft-1` aparece como advertencia no indexable estable.

Nota: npm 11 puede mostrar una advertencia indicando que `--mode` fue reenviado posicionalmente; el comando debe seguir interpretando correctamente el valor `stable` o `draft`.

### I4A-OKF-02 - rechazo de corpus inválido

```powershell
npm run okf:validate -- tests/fixtures/okf-invalid --mode stable
```

Esperado:

- código de salida `1`;
- dos errores `DUPLICATE_ID`, uno por archivo duplicado;
- no se crea ninguna proyección;
- la salida no contiene el cuerpo completo de los documentos.

### I4A-OKF-03 - compilación determinista

```powershell
$runId = [Guid]::NewGuid().ToString('N')
$projection = Join-Path $env:TEMP "kcp-i4a-$runId"
npm run okf:compile -- tests/fixtures/okf-valid $projection --mode stable
Get-Content -LiteralPath (Join-Path $projection 'manifest.json')
Get-ChildItem -Recurse -LiteralPath $projection
```

Esperado:

- código de salida `0`;
- `manifest.json` contiene `contractVersion: "okf-v0.2-i4a"`;
- `counts.errors` es `0` y `counts.indexable` es `1`;
- existe `documents/rule-1.md`;
- el archivo generado contiene Markdown sin frontmatter YAML;
- una segunda compilación del mismo corpus conserva el mismo `corpusHash` y el mismo orden;
- no se proyecta `draft-1` como documento estable.

### I4A-OKF-04 - indexación e idempotencia

Con MySQL y Qdrant levantados y las variables I3 cargadas:

```powershell
npm run okf:index -- tests/fixtures/okf-valid $projection --mode stable
npm run okf:index -- tests/fixtures/okf-valid $projection --mode stable
```

Esperado en la primera ejecución:

- se procesa `rule-1`;
- `failed: 0`;
- se generan chunks y vectores;
- la ACL y la procedencia se conservan.

Esperado en la segunda ejecución:

- `processed: 0`;
- `skipped: 1`;
- `failed: 0`;
- no se duplican chunks ni puntos Qdrant.

Consultar el estado de indexación:

```sql
SELECT knowledge_id, source_revision, status, chunk_count, vector_count
FROM knowledge_index_runs
ORDER BY started_at DESC;
```

### I4A-OKF-05 - protección del índice ante errores

Usar el corpus inválido con el comando de compilación:

```powershell
$invalidProjection = Join-Path $env:TEMP "kcp-i4a-invalid-$runId"
npm run okf:compile -- tests/fixtures/okf-invalid $invalidProjection --mode stable
```

Esperado:

- código de salida `1`;
- no existe `manifest.json` en `$invalidProjection`;
- no se inicia MySQL/Qdrant ni se llama al indexador;
- una proyección previa existente no es reemplazada por una salida inválida.

## Evidencia requerida

- commit, fecha/hora y versión de Node/npm;
- salida sanitizada de `validate`, `compile` e `index`;
- `manifest.json` sin contenido sensible;
- conteos de `knowledge_index_runs`, chunks y vectores;
- evidencia de que `draft-1` no fue indexado;
- evidencia de la segunda ejecución idempotente;
- confirmación de que no se copiaron secretos ni documentos completos.

## Criterio PASS/FAIL

| Criterio | PASS |
|---|---|
| Corpus válido | Valida y compila con código `0` |
| Corpus inválido | Devuelve código `1` sin proyección publicable |
| Determinismo | Conserva hash y orden entre ejecuciones |
| Gobernanza | Solo `stable` vigente entra en la proyección estable |
| Integración I3 | La proyección carga mediante `FilesystemDocumentSource` |
| Idempotencia | La repetición omite la revisión ya indexada |
| Seguridad | No se imprimen secretos ni contenido completo |

## Limpieza

Eliminar únicamente los directorios temporales creados durante la prueba, verificando primero su ruta absoluta:

```powershell
Get-ChildItem "$env:TEMP\kcp-i4a-*" -Directory
```

No ejecutar `docker compose down -v` salvo que se haya autorizado eliminar los volúmenes locales de prueba.
