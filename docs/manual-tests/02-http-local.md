# 02 — HTTP local

## Objetivo

Validar Streamable HTTP en modo local explícito, health/readiness y el rechazo de métodos no soportados.

## Preparación

```powershell
$env:KCP_HTTP_ENABLED = "true"
$env:KCP_HTTP_LOCAL_MODE = "true"
$env:KCP_HTTP_PORT = "8790"
npm run dev
```

## Casos

### HTTP-LOCAL-01 — liveness y readiness

```powershell
curl.exe -i http://127.0.0.1:8787/health
curl.exe -i http://127.0.0.1:8787/ready
```

Esperado: `200`, `{"status":"ok"}` y `200`, `{"status":"ready"}` después del arranque.

### HTTP-LOCAL-02 — initialize MCP

```powershell
$body = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"manual-test","version":"1.0"}}}'
curl.exe -i -X POST http://127.0.0.1:8790/mcp -H "Content-Type: application/json" -d $body
```

Esperado: `200` con resultado JSON-RPC de inicialización. En local explícito no se exige `Authorization`.

### HTTP-LOCAL-03 — método GET

```powershell
curl.exe -i http://127.0.0.1:8790/mcp
```

Esperado: `405`, header `Allow: POST` y mensaje seguro.

### HTTP-LOCAL-04 — límite de cuerpo

Repetir con un payload mayor que `KCP_HTTP_MAX_BODY_BYTES` y verificar rechazo `413` o equivalente, sin stack trace ni eco del payload.

## Evidencia

Guardar status codes, headers `Allow`/`Content-Type` y cuerpos JSON sin incluir variables de entorno sensibles.
