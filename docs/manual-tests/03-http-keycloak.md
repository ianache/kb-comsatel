# 03 — HTTP con Keycloak/JWKS

## Objetivo

Comprobar que HTTP exige bearer token y que el principal autenticado llega a ACL y auditoría.

## Preparación

```powershell
$env:KCP_HTTP_ENABLED = "true"
$env:KCP_HTTP_LOCAL_MODE = "false"
$env:KCP_KEYCLOAK_ENABLED = "true"
$env:KCP_KEYCLOAK_ISSUER = "https://<keycloak-host>/realms/<realm>"
$env:KCP_KEYCLOAK_AUDIENCE = "<audience>"
$env:KCP_KEYCLOAK_AZP = "<client-id>"
$env:KCP_HTTP_PORT = "8790"
npm run dev
```

Usar un token de prueba emitido por el realm. No guardarlo en archivos ni pegarlo completo en el ticket; usar `$env:KCP_TOKEN` durante la sesión.

## Casos

### KC-01 — ausencia de token

```powershell
curl.exe -i -X POST http://127.0.0.1:8790/mcp -H "Content-Type: application/json" -d '{}'
```

Esperado: `401`, `code: UNAUTHORIZED`, mensaje `Authentication required`.

### KC-02 — esquema inválido

```powershell
curl.exe -i -X POST http://127.0.0.1:8790/mcp -H "Authorization: Basic redacted" -H "Content-Type: application/json" -d '{}'
```

Esperado: `401`, `UNAUTHORIZED`, sin detalles del token.

### KC-03 — token válido

```powershell
$headers = @{ Authorization = "Bearer $env:KCP_TOKEN" }
$body = '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
Invoke-WebRequest http://127.0.0.1:8790/mcp -Method Post -Headers $headers -ContentType 'application/json' -Body $body
```

Esperado: `200` y exactamente las siete herramientas.

### KC-04 — claims de acceso

Usar dos tokens de prueba: uno con acceso a `architecture-reviewers` y otro sin ese grupo. Ejecutar la misma búsqueda o lectura restringida.

Esperado: el primero recibe evidencia autorizada; el segundo recibe resultado vacío/not-found seguro, nunca el extracto restringido. Repetir con token expirado, issuer incorrecto, audience incorrecta y `azp` no permitido: todos deben devolver `401`.

## Evidencia

Guardar solo subject truncado o hash del token, claims de autorización relevantes sin JWT completo, status code y resultado resumido.
