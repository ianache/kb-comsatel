# Pruebas manuales I5-E2 — resiliencia y hardening

Estas pruebas se ejecutan contra una instancia local. No usar tokens reales en comandos, capturas ni logs.

## Preparación

En PowerShell, desde la raíz del repositorio:

```powershell
$env:KCP_HTTP_ENABLED = "true"
$env:KCP_HTTP_LOCAL_MODE = "true"
$env:KCP_HTTP_PORT = "8790"
$env:KCP_OPERATION_TIMEOUT_MS = "10000"
$env:KCP_RATE_LIMIT_CAPACITY = "2"
$env:KCP_RATE_LIMIT_REFILL_PER_SECOND = "1"
$env:KCP_MAX_CONCURRENT_REQUESTS = "1"
$env:KCP_EGRESS_ALLOW_HTTP = "false"
$env:KCP_EGRESS_ALLOW_PRIVATE_NETWORKS = "false"
npm run dev
```

Abrir otra consola PowerShell. La carga JSON puede ser mínima porque estas pruebas verifican la admisión HTTP; para una invocación MCP completa usar MCP Inspector con el endpoint `http://127.0.0.1:8790/mcp`.

## I5E2-01 — Destino GitLab permitido

Configurar un proceso de publicación con el hostname permitido del entorno, sin incluir tokens en el documento:

```powershell
$env:KCP_GITLAB_PUBLICATION_ENABLED = "true"
$env:KCP_GITLAB_BASE_URL = "https://project.comsatel.com.pe"
$env:KCP_EGRESS_GITLAB_ALLOWED_HOSTS = "project.comsatel.com.pe"
```

Resultado esperado: la solicitud al adaptador llega al endpoint GitLab. Un hostname distinto, un puerto distinto de 443 o una URL `http` debe ser rechazado antes de ejecutar `fetch`.

## I5E2-02 — Rechazo SSRF

Probar con un allowlist que no convierta el destino en confiable y usar una URL privada en la configuración:

```powershell
$env:KCP_GITLAB_BASE_URL = "https://127.0.0.1"
$env:KCP_EGRESS_GITLAB_ALLOWED_HOSTS = "127.0.0.1"
npm run okf:publish -- tests/fixtures/okf-valid proposal
```

Resultado esperado: error seguro con código `EGRESS_DENIED`; no debe ejecutarse ninguna solicitud hacia loopback, `10.0.0.0/8`, `192.168.0.0/16`, `169.254.169.254`, IPv6 privada o multicast. El mensaje no debe mostrar token, query ni contenido del documento.

## I5E2-03 — Rate limit `429`

Con la instancia local preparada, ejecutar un burst contra `/mcp`:

```powershell
1..20 | ForEach-Object {
  Invoke-WebRequest -Method Post -Uri "http://127.0.0.1:8790/mcp" `
    -ContentType "application/json" -Body '{}' -UseBasicParsing `
    -ErrorAction SilentlyContinue | Select-Object StatusCode, Headers
}
```

Resultado esperado: algunas respuestas `429`, con cuerpo `RATE_LIMITED` y encabezado `Retry-After`. Después de esperar el número de segundos indicado, una solicitud vuelve a ser admitida.

## I5E2-04 — Límite de concurrencia `503`

Con `KCP_MAX_CONCURRENT_REQUESTS=1`, enviar varias solicitudes en paralelo:

```powershell
$jobs = 1..10 | ForEach-Object {
  Start-Job -ScriptBlock {
    Invoke-WebRequest -Method Post -Uri "http://127.0.0.1:8790/mcp" `
      -ContentType "application/json" -Body '{}' -UseBasicParsing `
      -ErrorAction SilentlyContinue
  }
}
$jobs | Wait-Job | Receive-Job | Select-Object StatusCode, Headers
$jobs | Remove-Job
```

Resultado esperado: las solicitudes que superan el límite retornan `503`, código `CONCURRENCY_LIMITED` y `Retry-After: 1`. La métrica de solicitudes en vuelo vuelve a cero cuando terminan.

## I5E2-05 — Timeout `504`

Configurar temporalmente una dependencia de prueba que tarde más que el deadline:

```powershell
$env:KCP_OPERATION_TIMEOUT_MS = "100"
```

Invocar la herramienta o adaptador desde MCP Inspector usando un fixture/fetcher de prueba que no responda dentro de 100 ms.

Resultado esperado: `504`/`DEADLINE_EXCEEDED` en HTTP, o error MCP seguro equivalente en STDIO. No deben quedar timers ni solicitudes nuevas después del deadline.

## I5E2-06 — Circuit breaker y recuperación

Usar una dependencia de prueba que devuelva errores de red o HTTP 5xx repetidamente. Ejecutar solicitudes hasta superar `KCP_BREAKER_FAILURE_THRESHOLD`.

```powershell
$env:KCP_BREAKER_FAILURE_THRESHOLD = "3"
$env:KCP_BREAKER_OPEN_MS = "5000"
```

Resultado esperado:

1. Los primeros fallos se registran como dependencia no disponible.
2. Al superar el umbral, las siguientes llamadas fallan rápidamente con `503`/`DEPENDENCY_UNAVAILABLE`.
3. Tras `KCP_BREAKER_OPEN_MS`, una probe half-open puede pasar.
4. Una probe exitosa cierra el circuito y las solicitudes posteriores vuelven a ejecutarse.

## Verificación de métricas

Consultar el endpoint de salud/operación que exponga métricas en el entorno configurado y comprobar la presencia de:

- `kcp_resilience_events_total`
- `kcp_http_admission_total`
- `kcp_http_inflight`

Los labels deben ser nombres fijos de dependencia/evento/resultado. No deben contener tokens, URLs completas, queries, texto de documentos ni PII.

## Limpieza

Cerrar el proceso `npm run dev` y eliminar las variables temporales de la sesión:

```powershell
Get-ChildItem Env:KCP_* | Remove-Item
```
