# I5-D — guía manual para los seis casos con timeout

## Objetivo

Repetir de forma aislada los seis casos que excedieron el límite predeterminado de 5 segundos durante la ejecución completa de `npm test`. Esta guía verifica si el comportamiento es correcto cuando cada caso dispone de 15 segundos.

> El aumento del timeout es únicamente una condición de diagnóstico para la prueba manual; no modifica el código de producción ni el timeout configurado por defecto.

## Preparación

Ejecutar desde la raíz del worktree de I5-D:

```powershell
Set-Location "C:\Users\ianache\Desktop\DATA\01-DOCUMENTOS\02-PROYECTOS\114-KB-Comsatel\kb-comsatel\.worktrees\i5d-golden-evaluation"
npm ci
npm run build
$env:MANUAL_OUT = ".tmp/i5d-timeout-manual"
New-Item -ItemType Directory -Force $env:MANUAL_OUT | Out-Null
git rev-parse HEAD
```

Guardar el commit mostrado y la fecha/hora en la evidencia. No registrar tokens, contraseñas ni contenido completo de documentos.

## Casos

En cada caso, el resultado esperado es `1 passed`, `0 failed`, sin el texto `Test timed out` y sin errores de transporte como `Connection closed`.

### I5D-TMO-01 — indexación I5-B

```powershell
npx vitest run --testTimeout=15000 tests/ingestion/i5b-indexing.test.ts -t "compiles, writes and indexes a valid stable corpus in order" 2>&1 |
  Tee-Object -FilePath "$env:MANUAL_OUT/I5D-TMO-01.log"
```

Verificar que el corpus estable se compila, se escribe y se indexa en orden. Registrar el resumen de Vitest y la duración.

### I5D-TMO-02 — contrato STDIO y plantillas

```powershell
npx vitest run --testTimeout=15000 tests/mcp/stdio-contract.test.ts -t "exposes read-only knowledge tools and resource templates" 2>&1 |
  Tee-Object -FilePath "$env:MANUAL_OUT/I5D-TMO-02.log"
```

Verificar que el proceso STDIO expone las herramientas de conocimiento de solo lectura y las plantillas de recursos.

### I5D-TMO-03 — evidencia citada por búsqueda

```powershell
npx vitest run --testTimeout=15000 tests/mcp/stdio-contract.test.ts -t "returns cited search evidence for the public seed catalog" 2>&1 |
  Tee-Object -FilePath "$env:MANUAL_OUT/I5D-TMO-03.log"
```

Verificar que la respuesta de búsqueda contiene evidencia citada del catálogo público semilla.

### I5D-TMO-04 — error estructurado de límite inválido

```powershell
npx vitest run --testTimeout=15000 tests/mcp/stdio-contract.test.ts -t "returns a structured invalid-input error for invalid search limits" 2>&1 |
  Tee-Object -FilePath "$env:MANUAL_OUT/I5D-TMO-04.log"
```

Verificar que un límite de búsqueda inválido produce un error estructurado y seguro, sin stack trace ni datos sensibles.

### I5D-TMO-05 — errores seguros de recursos inválidos

```powershell
npx vitest run --testTimeout=15000 tests/mcp/stdio-contract.test.ts -t "returns structured safe errors for invalid resource inputs" 2>&1 |
  Tee-Object -FilePath "$env:MANUAL_OUT/I5D-TMO-05.log"
```

Verificar que entradas inválidas para recursos producen errores estructurados y seguros.

### I5D-TMO-06 — endpoint de salud

```powershell
npx vitest run --testTimeout=15000 tests/ops/health-server.test.ts -t "returns a healthy response" 2>&1 |
  Tee-Object -FilePath "$env:MANUAL_OUT/I5D-TMO-06.log"
```

Verificar que el servidor de salud responde correctamente y que el proceso se cierra sin quedar bloqueado.

## Registro de resultados

Completar una fila por caso:

| Caso | Resultado | Duración | Log | Observaciones |
|---|---|---:|---|---|
| I5D-TMO-01 | PASS / FAIL | | `.tmp/i5d-timeout-manual/I5D-TMO-01.log` | |
| I5D-TMO-02 | PASS / FAIL | | `.tmp/i5d-timeout-manual/I5D-TMO-02.log` | |
| I5D-TMO-03 | PASS / FAIL | | `.tmp/i5d-timeout-manual/I5D-TMO-03.log` | |
| I5D-TMO-04 | PASS / FAIL | | `.tmp/i5d-timeout-manual/I5D-TMO-04.log` | |
| I5D-TMO-05 | PASS / FAIL | | `.tmp/i5d-timeout-manual/I5D-TMO-05.log` | |
| I5D-TMO-06 | PASS / FAIL | | `.tmp/i5d-timeout-manual/I5D-TMO-06.log` | |

## Criterio de cierre

Los seis casos son manualmente operativos si todos terminan en PASS con `--testTimeout=15000`. Si alguno falla, conservar su log completo y anotar si fue aserción, timeout o error de transporte. Después de los seis casos, repetir opcionalmente toda la suite con el mismo umbral:

```powershell
npx vitest run --testTimeout=15000 2>&1 | Tee-Object -FilePath "$env:MANUAL_OUT/full-suite-15s.log"
```
