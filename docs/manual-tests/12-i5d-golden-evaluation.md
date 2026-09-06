# 12 - I5-D evaluación piloto con preguntas de oro

Validar offline el arnés de evaluación del flujo MCP con 30 casos versionados. Esta prueba no requiere MySQL, Qdrant, GitLab, Google Drive, Keycloak ni tokens.

## I5D-GOLDEN-01 - ejecución completa

Desde la raíz del repositorio:

```powershell
npm ci
npm run eval:golden
```

Esperado:

- exit code `0`;
- resumen JSON con `datasetSize=30`, `executed=30`, `passed=30`, `failed=0` y `complete=true`;
- se crean únicamente `.tmp/i5d-golden-evaluation/report.json` y `report.md`;
- el reporte contiene métricas agregadas, IDs de caso y códigos de fallo, nunca preguntas completas, extractos, Authorization, Bearer, tokens o secretos.

Inspeccionar solo el resumen:

```powershell
Get-Content .tmp/i5d-golden-evaluation/report.json | ConvertFrom-Json |
  Select-Object datasetVersion,datasetSize,executed,passed,failed,complete,metrics
```

## I5D-GOLDEN-02 - métricas y umbrales

```powershell
$report = Get-Content .tmp/i5d-golden-evaluation/report.json | ConvertFrom-Json
$report.metrics
$report.thresholds
```

Esperado:

- `evidenceCitationRate` es al menos `0.90`;
- `insufficientAccuracy` es `1`;
- `aclNegativeAccuracy` es `1`;
- `determinismRate` es `1`;
- `averageLatencyMs` y `p95LatencyMs` son numéricos;
- `complete` es `true`.

## I5D-GOLDEN-03 - dataset incompleto

Crear una copia temporal con 29 casos y ejecutar el CLI:

```powershell
$source = Get-Content tests/fixtures/golden/golden-cases.json -Raw | ConvertFrom-Json
$source.cases = @($source.cases | Select-Object -First 29)
$incomplete = Join-Path $env:TEMP "kcp-i5d-incomplete.json"
$source | ConvertTo-Json -Depth 20 | Set-Content $incomplete

npm run eval:golden -- $incomplete .tmp/i5d-golden-incomplete
$LASTEXITCODE
```

Esperado: exit code `1`, mensaje seguro y ningún reporte marcado `complete=true`.

## I5D-GOLDEN-04 - rechazo de comando inválido

```powershell
npx tsx src/evaluation/golden-cli.ts unknown-command
$LASTEXITCODE
```

Esperado: exit code `2` y mensaje de uso sin stack trace.

## I5D-GOLDEN-05 - evidencia manual

Guardar en el ticket/MR únicamente:

- timestamp y commit probado;
- resumen de `report.json` sin contenido documental;
- exit codes de los escenarios I5D-GOLDEN-01, 03 y 04;
- hash del archivo `tests/fixtures/golden/golden-cases.json`.

No adjuntar el JSON completo si contiene datos fuera del fixture, ni modificar fuentes GitLab/Drive durante la prueba.

## Limpieza

Eliminar solo los artefactos temporales creados por esta prueba:

```powershell
Remove-Item -LiteralPath .tmp/i5d-golden-evaluation -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath .tmp/i5d-golden-incomplete -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path $env:TEMP "kcp-i5d-incomplete.json") -Force -ErrorAction SilentlyContinue
```
