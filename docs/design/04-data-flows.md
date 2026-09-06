# Flujos de datos end-to-end

Trazas concretas de los flujos más representativos, capa por capa. Complementa
[`03-security-and-identity.md`](./03-security-and-identity.md) (que ya cubre el flujo de login) y
los documentos de arquitectura de cada sistema.

## 1. Búsqueda de repositorios GitLab (Portal)

Ilustra el patrón estándar de toda operación de dominio del Portal: Angular → BFF (con inyección
de token) → FastAPI → sistema externo, con el secreto resuelto de Vault en el medio.

```
Usuario escribe "collaboration" en "Administrar repositorios"
  │
  ▼
administrar-repositorios.component.ts (Angular, MicroUI)
  debounce 300ms → ingesta-api.service.ts.searchGitlabRepos(connectorId, "collaboration")
  │  fetch GET {BFF}/api/ingesta/gitlab/{connectorId}/search?q=collaboration
  │  credentials: "include"  (cookie de sesión del BFF)
  ▼
portal/bff/src/app/api/ingesta/gitlab/[id]/search/route.ts (Next.js)
  getSession() → si no hay sesión, 401
  fetch {INGESTION_API_URL}/api/v1/gitlab/connectors/{id}/search?q=...
    headers: Authorization: Bearer <access_token>   ← inyectado server-side, nunca visto por el browser
  ▼
routes_gitlab.py :: search_repos (FastAPI)
  require_role("km-admin", "km-auditor")  ← valida el JWT contra JWKS de Keycloak
  _require_connector(id) → obtiene Connector { base_uri, vault_secret_ref }
  _resolve_token(vault_secret_ref) → VaultClient.get_secret_value(path relativo)
    (el valor del token vive solo en esta función, nunca sale de aquí)
  GitLabClient(base_uri, token).search_projects("collaboration")
    (si el texto es numérico, en vez llama a get_project(id) — búsqueda exacta)
  ▼
GitLab real (https://gitlab.comsatel.com.pe/api/v4/projects?search=collaboration)
  responde 200 con proyectos, o 401/timeout si el token/URL están mal
  │
  ▼ (camino de éxito)                              ▼ (camino de error)
GitLabSearchResult[] {id, nombre, grupo}            update_connector(id, healthy=False)
  se devuelve tal cual hasta el componente Angular    HTTPException(503, detail="No se pudo
  que renderiza la tabla de resultados                conectar a GitLab: <detalle real>")
                                                       → el frontend muestra ese detalle real
                                                         en el banner de error (no un mensaje
                                                         genérico) y el conector se marca
                                                         "Con incidencias" en Conectores y Fuentes
```

Puntos de diseño relevantes:
- El token de GitLab nunca atraviesa el BFF ni llega al browser — se resuelve y se usa enteramente
  dentro de `ingestion-api`.
- Un fallo real (URL mal configurada, token vencido) se refleja tanto en el mensaje de error
  puntual como en el estado `healthy` del conector, visible desde la pantalla general de
  Conectores.
- Ver `docs/superpowers/specs/2026-09-06-gitlab-repos-operativo-design.md` para la decisión de
  diseño completa detrás de este flujo (por qué búsqueda bajo demanda y no un catálogo
  precargado, por qué las ramas se cargan de forma perezosa al seleccionar un repo, etc.).

## 2. Gestión de credenciales Vault

```
Usuario abre "Credenciales (Vault)" → vault-credenciales.component.ts
  GET {BFF}/api/ingesta/vault/secrets           → lista de paths (sin valores)
  GET {BFF}/api/ingesta/vault/secrets/{path}/metadata  (por cada path) → versión, fecha
  ▼
routes_vault.py (FastAPI, require_role("km-admin"))
  VaultClient.list_secrets() / get_secret_metadata(path)
  ▼
Vault real (HashiCorp, KV v2) — GET /v1/<mount>/metadata/<prefix>[/<path>]

Usuario crea/edita una credencial (clave/valor) → "Guardar"
  PUT {BFF}/api/ingesta/vault/secrets/{path}   body: {clave: valor, ...}
  ▼
routes_vault.py :: write_secret
  VaultClient.write_secret(path, data) → POST /v1/<mount>/data/<prefix>/<path>
  204 No Content en éxito
```

El valor que el usuario escribe en el formulario viaja Angular → BFF → FastAPI → Vault en una sola
dirección de escritura; en ningún punto de vuelta (lectura posterior) el valor real vuelve a
aparecer en una respuesta — solo metadata. Esto es una decisión de producto explícita (ver
`docs/superpowers/specs/2026-09-06-vault-credenciales-design.md`), no una limitación técnica de
Vault.

## 3. Compilación e ingesta OKF (de fuente a catálogo consumible)

Este flujo conecta conceptualmente el Portal con el servidor MCP, aunque hoy corren como procesos
separados sin integración automática directa (el Portal registra/dispara batches de ingesta; el
compilador OKF y el servidor MCP son parte del código en `src/`, ejecutados vía los comandos
`npm run okf:*` / `npm run i3:index` descritos en
[`01-mcp-knowledge-server.md`](./01-mcp-knowledge-server.md)):

```
Fuente (GitLab MR, carpeta Drive, upload) — documentos Markdown con frontmatter OKF v0.2
  ▼
src/okf/corpus-reader.ts + frontmatter-parser.ts   → lee el corpus
src/okf/okf-schema.ts                              → valida el frontmatter (knowledgeId,
                                                        artifactType, classification, status,
                                                        acl, relations, ...)
src/okf/compiler.ts :: compileOkfCorpus()          → compila a artefactos catalog-ready
src/okf/projection-writer.ts                       → escribe las proyecciones
  ▼
Catálogo (memory-repository / mysql-repository / hybrid-repository, según tier activo)
  ▼
Knowledge Context MCP (src/mcp/*)                  → un agente MCP llama search_knowledge,
                                                        build_context_pack, etc. contra ese
                                                        catálogo ya compilado
```

Si el tier I3 está activo, el mismo corpus también pasa por `src/retrieval/*` (chunking,
embeddings, Qdrant) para habilitar búsqueda híbrida semántica+relacional — ver la tabla de tiers en
[`01-mcp-knowledge-server.md`](./01-mcp-knowledge-server.md).

## 4. Health check del Shell (estado de servicios)

Flujo corto pero ilustra el mismo patrón de proxy-con-sesión aplicado a un caso trivial:

```
Usuario abre el popup "Estado de servicios" en el sidebar del Shell
  ▼
app.component.ts :: checkServices()
  fetch {BFF}/api/health              (credentials: include)  → BFF Gateway
  fetch {BFF}/api/health/ingestion    (credentials: include)  → Microservicios
  ▼
portal/bff/src/app/api/health/route.ts             → responde {status:"ok"} (liveness propio)
portal/bff/src/app/api/health/ingestion/route.ts    → getSession() → si hay sesión,
                                                         fetch {INGESTION_API_URL}/health
                                                         (timeout 3s) → ok/down
  ▼
Cada fila del popup se pinta verde ("Operativo") o roja ("Caído") según la respuesta;
el punto de estado del sidebar refleja el peor de los dos.
```
