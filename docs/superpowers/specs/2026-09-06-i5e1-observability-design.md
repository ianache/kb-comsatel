# I5-E1 — Diseño de observabilidad base

## 1. Objetivo

Agregar observabilidad operativa al runtime de Knowledge Context MCP sin cambiar el contrato de las siete herramientas MCP ni exponer contenido documental, tokens, JWT o secretos. I5-E1 entregará métricas Prometheus, logs estructurados con correlación y una capa de trazas OpenTelemetry opcional, reutilizando los endpoints operativos existentes.

## 2. Trazabilidad

Este incremento implementa la primera parte de I5-E y cubre principalmente:

- `FR-09`: auditoría de identidad, herramienta, resultado agregado, latencia, denegaciones y correlation ID.
- `FR-12`: endpoints operativos y métricas Prometheus fuera del contrato MCP público.
- `NFR-03`: OpenTelemetry para trazas, métricas y logs estructurados.
- `NFR-05`: medición de latencia y P95 de búsqueda.
- `NFR-08`: logs sin secretos, texto documental completo ni PII innecesaria.

La fuente normativa es `00-ReqSpec/REQSPEC_PRD_Knowledge_Context_MCP.md`; se omite el PRD legado.

## 3. Alcance

### Incluido

1. Endpoint `GET /metrics` en el servidor operativo, separado del transporte MCP.
2. Métricas de solicitudes HTTP/MCP, llamadas STDIO, latencia, errores, denegaciones y estado de dependencias.
3. Logger estructurado con campos mínimos: timestamp, nivel, servicio, ambiente, operación, transporte y `correlationId`.
4. Propagación de un correlation ID recibido de forma segura o generado localmente por solicitud.
5. Instrumentación de las herramientas MCP y de las dependencias principales sin registrar payloads ni extractos.
6. Exportación OpenTelemetry configurable y deshabilitada por defecto en desarrollo local.
7. Pruebas unitarias, de contrato, de seguridad de salida y manuales para `/metrics` y correlación.

### Fuera de alcance

- Rate limiting, circuit breakers, HPA y despliegue OKE; se implementarán en I5-E2/I5-E3.
- Cambios de nombres, argumentos o resultados de las herramientas MCP.
- Envío obligatorio a Prometheus, Grafana, Loki o Tempo durante las pruebas locales.
- Persistencia adicional de auditoría en MySQL; se reutiliza el `AuditSink` existente.
- Registro de queries, extractos, filtros completos, contenido de documentos, tokens o cabeceras de autorización.

## 4. Diseño técnico

### 4.1 Componentes

```text
HTTP / STDIO MCP
        |
        v
  ObservabilityContext
        |
  +-----+------------------+
  |                        |
  v                        v
MetricsRegistry       StructuredLogger
  |                        |
  v                        v
GET /metrics          stderr / stdout-safe logs
        |
        v
 Optional OpenTelemetry exporter
```

La observabilidad será una dependencia explícita del runtime, con implementaciones `noop` o locales cuando no esté habilitada. STDIO conservará stdout exclusivamente para JSON-RPC; los logs irán a stderr.

### 4.2 Métricas

Usar nombres estables y etiquetas de baja cardinalidad:

| Métrica | Tipo | Etiquetas |
|---|---|---|
| `kcp_mcp_requests_total` | counter | `transport`, `operation`, `outcome` |
| `kcp_mcp_request_duration_ms` | histogram | `transport`, `operation` |
| `kcp_mcp_errors_total` | counter | `transport`, `operation`, `error_code` |
| `kcp_mcp_denials_total` | counter | `operation`, `reason` |
| `kcp_dependency_health` | gauge | `dependency` |
| `kcp_dependency_requests_total` | counter | `dependency`, `operation`, `outcome` |
| `kcp_dependency_duration_ms` | histogram | `dependency`, `operation` |
| `kcp_audit_events_total` | counter | `operation`, `outcome` |

No se usarán como etiquetas `userId`, `group`, `query`, `knowledgeId`, URI, JWT, correlation ID ni texto libre.

El endpoint expondrá formato Prometheus y no requerirá autenticación dentro del host loopback actual. La configuración de exposición remota queda fuera de I5-E1.

### 4.3 Correlación y logs

Cada operación recibirá un correlation ID válido de máximo 128 caracteres desde una cabecera allowlisted o generará un UUID. Valores inválidos se reemplazarán por uno generado, nunca se reflejarán sin sanitizar.

Los eventos estructurados contendrán únicamente:

```json
{
  "level": "info",
  "service": "knowledge-context-mcp",
  "environment": "local",
  "transport": "http",
  "operation": "search_knowledge",
  "outcome": "success",
  "durationMs": 12,
  "correlationId": "safe-correlation-id"
}
```

Los errores registrarán `errorCode` seguro y duración, pero no mensajes de excepción de dependencias externas si pudieran contener URLs, credenciales o contenido.

### 4.4 OpenTelemetry

La instrumentación se controlará con configuración explícita:

- `KCP_OTEL_ENABLED=false` por defecto.
- `KCP_OTEL_ENDPOINT` opcional para OTLP/HTTP.
- `KCP_OTEL_SERVICE_NAME` con valor por defecto `knowledge-context-mcp`.
- `KCP_OTEL_ENVIRONMENT` con valor por defecto `local`.

Cuando esté deshabilitada, no se realizarán conexiones externas ni se generarán warnings. Cuando esté habilitada, los spans usarán nombres como `mcp.search_knowledge` y `dependency.qdrant.search`, con atributos de baja cardinalidad y sin payloads.

### 4.5 Compatibilidad

- `/health` y `/ready` conservarán sus respuestas actuales.
- `/metrics` no se registrará como herramienta ni recurso MCP.
- El contrato STDIO permanecerá sin cambios y stdout seguirá reservado al protocolo.
- La implementación funcionará con runtime en memoria y con I3 habilitado.
- La auditoría de negocio seguirá usando `AuditSink`; las métricas no reemplazan la auditoría.

## 5. Configuración y fallos

La configuración inválida debe fallar al arranque con un mensaje seguro. Un exportador OTEL no disponible no debe impedir el arranque cuando `KCP_OTEL_ENABLED=false`; con OTEL habilitado, el comportamiento será fail-open y registrará un evento agregado, sin bloquear una solicitud MCP.

El registro de métricas debe ser bounded: nombres y etiquetas provienen de enums internos. Una excepción del endpoint `/metrics` devolverá error operativo sin filtrar detalles internos.

## 6. Seguridad y privacidad

- Sanitizar nombres de operación, transporte, dependencia y código de error contra caracteres de control.
- Nunca registrar `Authorization`, `Cookie`, `Set-Cookie`, JWT, tokens de GitLab/Drive, URLs con credenciales ni cuerpos de solicitud/respuesta.
- No usar texto libre ni identificadores de usuario como etiquetas Prometheus.
- Mantener `/metrics` en el host operativo permitido por la configuración existente.
- Cubrir con pruebas que las salidas no contienen `secret`, `token`, `jwt`, `password`, `Bearer` ni extractos de documentos.

## 7. Criterios de aceptación

1. `GET /health` y `GET /ready` mantienen su comportamiento actual.
2. `GET /metrics` responde con contenido Prometheus y expone las métricas base después de una solicitud MCP.
3. Una solicitud exitosa y una fallida incrementan contadores con etiquetas esperadas y de baja cardinalidad.
4. Las métricas de latencia permiten calcular P95 sin almacenar queries ni IDs de documentos.
5. Un correlation ID válido se conserva en logs; uno inválido se reemplaza de forma segura.
6. STDIO no emite logs ni JSON ajeno al protocolo en stdout.
7. OTEL deshabilitado no realiza llamadas de red externas.
8. Las pruebas de seguridad demuestran ausencia de secretos, JWT, payloads y contenido documental en logs y métricas.
9. El contrato MCP de siete herramientas y tres recursos permanece sin cambios.
10. Existe una prueba manual documentada para `/metrics`, correlación y modo OTEL local deshabilitado.

## 8. Verificación prevista

```powershell
npm test -- tests/ops tests/mcp tests/security
npm run typecheck
npm run build
npm run smoke
git diff --check
```

La validación manual arrancará el servicio local, llamará `/health`, `/ready` y `/metrics`, ejecutará una operación MCP y comprobará que el cuerpo de métricas y los logs no contienen datos sensibles.
