# 15 - I5-E1 observabilidad base

## Objetivo

Validar métricas Prometheus, endpoints operativos, correlación de operaciones y comportamiento seguro con OpenTelemetry deshabilitado.

## Preparación

Desde la raíz del proyecto:

```powershell
$env:KCP_OTEL_ENABLED = "false"
$env:KCP_OTEL_SERVICE_NAME = "knowledge-context-mcp"
$env:KCP_OTEL_ENVIRONMENT = "local"
npm run build
npm run dev
```

Mantener el servidor ejecutándose y usar una segunda terminal. El endpoint operativo por defecto es `http://127.0.0.1:8787`.

## I5E1-OBS-01 — health y readiness

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health
Invoke-WebRequest http://127.0.0.1:8787/ready -UseBasicParsing | Select-Object StatusCode, Content
```

Resultado esperado:

- `/health` devuelve `{"status":"ok"}` con HTTP 200.
- `/ready` devuelve `{"status":"ready"}` con HTTP 200 después del arranque.

## I5E1-OBS-02 — métricas Prometheus

```powershell
$metrics = Invoke-WebRequest http://127.0.0.1:8787/metrics -UseBasicParsing
"HTTP=$($metrics.StatusCode)"
$metrics.Headers["Content-Type"]
$metrics.Content
```

Resultado esperado:

- HTTP 200.
- Content-Type contiene `text/plain`.
- El cuerpo contiene `kcp_mcp_requests_total`, `kcp_mcp_request_duration_ms` y `kcp_dependency_health`.
- No contiene `Bearer`, `token`, `jwt`, `password`, `secret` ni texto documental.

## I5E1-OBS-03 — solicitud MCP y correlación

Con `KCP_HTTP_ENABLED=true` y `KCP_HTTP_LOCAL_MODE=true`, reiniciar el servidor y ejecutar:

```powershell
$headers = @{ "x-correlation-id" = "manual-obs-001" }
$body = @{
  jsonrpc = "2.0"
  id = 1
  method = "tools/call"
  params = @{
    name = "search_knowledge"
    arguments = @{ query = "premium unit"; limit = 8 }
  }
} | ConvertTo-Json -Depth 8

Invoke-RestMethod http://127.0.0.1:8790/mcp -Method Post `
  -Headers $headers -ContentType "application/json" -Body $body
```

Después consultar nuevamente `/metrics`.

Resultado esperado:

- La respuesta MCP no cambia de forma por la observabilidad.
- Aumenta `kcp_mcp_requests_total` con `transport="http"`, `operation="search_knowledge"` y `outcome="success"`.
- Aparece una observación de `kcp_mcp_request_duration_ms`.
- `manual-obs-001` no aparece en `/metrics`; solo puede aparecer en el log estructurado de stderr.

## I5E1-OBS-04 — OTEL deshabilitado

Con `KCP_OTEL_ENABLED=false`, revisar el arranque y la operación anterior.

Resultado esperado:

- El servidor arranca sin requerir un collector OTLP.
- No se realizan conexiones externas de OTEL.
- STDOUT permanece reservado al protocolo cuando se ejecuta `node dist/server.js --stdio`.

## Evidencia y limpieza

Registrar fecha/hora, commit probado, respuestas sanitizadas de `/health`, `/ready`, `/metrics`, la solicitud MCP y una captura de los logs sin secretos. Detener el servidor con `Ctrl+C` y limpiar únicamente archivos temporales creados para la prueba.
