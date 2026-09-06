# Portal KM Comsatel — Arquitectura

**Ubicación:** `portal/` · **Patrón:** Shell + MicroUI + BFF · **Diseño de referencia:** proyecto
Claude Design "Portal KM Comsatel" (`portal/shared/design-tokens/comsatel-tokens.css`, tema
crimson `#c9141d`)

## Qué es

La aplicación web que usan operadores humanos (`km-admin`, `km-curador`, `km-operador`,
`km-auditor`) para gestionar conectores de fuentes de datos (GitLab, Google Drive, bases de
datos), disparar y monitorear ingesta, y administrar credenciales. Es la pieza que **alimenta**
el catálogo de conocimiento que luego consume el Knowledge Context MCP (ver
[`01-mcp-knowledge-server.md`](./01-mcp-knowledge-server.md)).

## Piezas y responsabilidades

```
Browser
  └─ shell/                     Angular host: layout, guard de auth, host de Module Federation
       └─ micro-ui-ingesta/     Angular remote (MFE) cargado en runtime — pantallas de ingesta
  └─ bff/                       Next.js — única pieza con sesión; PKCE contra Keycloak;
       │                        expone /api/* que shell/MFE consumen con cookie httpOnly
       └─ services/
            └─ ingestion-api/   FastAPI — dominio: conectores, fuentes, batches, drafts OKF.
                                  Valida el token que reenvía el BFF contra el JWKS de Keycloak.
```

- **Shell** (`portal/shell/`) — Angular 18 standalone. Monta el layout (header, sidebar,
  `<router-outlet>`) y carga cada MicroUI como remote de Webpack Module Federation. No contiene
  lógica de negocio de dominio — solo chrome, sesión y navegación.
- **MicroUI** (`portal/micro-ui-ingesta/`) — Angular 18 standalone, un remote por dominio
  funcional. Hoy existe un solo dominio (`ingesta`); dominios futuros (gobierno OKF, calidad) se
  agregan como `portal/micro-ui-<dominio>/` siblings.
- **BFF** (`portal/bff/`) — Next.js 15 (JavaScript/TypeScript sobre Node). Dueño exclusivo del
  flujo OIDC Authorization Code + PKCE contra Keycloak. Guarda la sesión en un store file-backed
  del lado servidor y entrega al browser solo una cookie httpOnly opaca — el browser **nunca** ve
  el `access_token`. Expone `/api/ingesta/*`, `/api/auth/*`, `/api/health/*` que reenvían al
  microservicio con `Authorization: Bearer <token>` inyectado server-side.
- **Microservicio de dominio** (`portal/services/ingestion-api/`) — Python + FastAPI. Valida cada
  JWT recibido contra el JWKS de Keycloak (nunca confía en la identidad que declara el BFF sin
  validarla criptográficamente) y aplica RBAC por rol en cada endpoint.

## Por qué BFF + PKCE (no OIDC puro en el browser)

El shell/MicroUI corren 100% como SPA en el browser. Un flujo OIDC "puro" con PKCE ejecutado en el
cliente expondría el `access_token` al browser (accesible por cualquier script, XSS incluido). En
su lugar, el **BFF** ejecuta el Authorization Code + PKCE (genera `code_verifier`/`code_challenge`,
intercambia el `code` por tokens del lado servidor) y solo entrega al browser una cookie de sesión
opaca — el patrón "BFF pattern" que OAuth 2.1 recomienda para SPAs. Ver
[`03-security-and-identity.md`](./03-security-and-identity.md) para el detalle completo del flujo.

## Angular Shell — estructura

Componente raíz `AppComponent` (`portal/shell/src/app/app.component.ts`):

- **Header**: logo, buscador (placeholder visual, sin lógica aún), campana de notificaciones
  (visual), avatar de usuario con dropdown (nombre/email/roles reales de la sesión, "Settings"
  deshabilitado, "Logout" funcional).
- **Sidebar**: navegación (`Panel operacional`, `Conectores y fuentes`, `Credenciales (Vault)`),
  y en el pie: versión del build (leída de `package.json` en compile-time) + un indicador de
  estado de servicios (popup con health checks reales de BFF Gateway y Microservicios, vía
  `GET /api/health` y `GET /api/health/ingestion`).
- `auth.guard.ts` — guarda las rutas, llama a `AuthService.loadSession()`.
- `auth.service.ts` — hace `fetch` a `${BFF_BASE_URL}/api/auth/session` con `credentials:
  "include"`; expone `session` como signal (`{authenticated, name, email, roles}`) y
  `redirectToLogin()` (manda al browser a la raíz del BFF, no directo a Keycloak — la raíz del BFF
  es la pantalla "Iniciar sesión institucional").
- `webpack.config.js` — declara los remotes de Module Federation como URL plana (sin prefijo
  `nombre@`, por el formato de contenedor ESM que usa Angular 18).

## MicroUI de Ingesta — pantallas

`portal/micro-ui-ingesta/src/app/pages/`:

| Pantalla | Ruta | Qué hace |
|---|---|---|
| `dashboard/` | `/ingesta` | Panel operacional: batches de ingesta, contadores |
| `conectores/` | `/ingesta/conectores` | Lista de conectores, detalle operacional, alta de conector (panel lateral) |
| `administrar-repositorios/` | `/ingesta/conectores/:id/repositorios` | Búsqueda en vivo de repos GitLab reales por nombre/ID, selección de rama, vinculación |
| `seleccionar-carpetas/` | `/ingesta/conectores/:id/carpetas` | Selección de carpetas Google Drive para un conector |
| `esquemas-mapeados/` | `/ingesta/conectores/:id/esquemas` | Vista de solo lectura de tablas mapeadas (conectores de tipo BD) |
| `vault-credenciales/` | `/ingesta/vault` | Gestión de credenciales en HashiCorp Vault (solo metadata, nunca valores) |

`ingesta-api.service.ts` centraliza **todas** las llamadas HTTP del MicroUI — nunca llama a
`ingestion-api` directo ni a Keycloak; todo pasa por el BFF (`${BFF_BASE_URL}/api/ingesta/*`,
`/api/auth/*`) con `credentials: "include"`.

## BFF — rutas expuestas

`portal/bff/src/app/api/`:

**Auth (PKCE):**
- `auth/login` — inicia el Authorization Code + PKCE contra Keycloak.
- `auth/callback` — recibe el `code`, lo intercambia por tokens, crea la sesión, decodifica claims
  (`sub`, `name`, `email`, `realm_access.roles`) y setea la cookie httpOnly.
- `auth/logout` — cierra la sesión del lado servidor y del lado Keycloak.
- `auth/session` — endpoint liviano que el shell consulta para saber si hay sesión y qué roles
  tiene, sin exponer nunca el `access_token`.

**Health:**
- `health` — liveness del propio BFF.
- `health/ingestion` — proxea el `/health` de `ingestion-api`.

**Dominio (`ingesta/*`, todas requieren sesión, inyectan `Authorization: Bearer <token>`):**
- `ingesta/connectors` (GET/POST), `ingesta/connectors/[id]` (PATCH)
- `ingesta/connectors/[id]/repos` (GET/POST — vínculo de repos GitLab)
- `ingesta/connectors/[id]/folders` (GET/POST — vínculo de carpetas Drive)
- `ingesta/connectors/[id]/schemas` (GET — tablas mapeadas)
- `ingesta/gitlab/[id]/search` (GET — búsqueda real de proyectos GitLab)
- `ingesta/gitlab/[id]/branches/[repoId]` (GET — ramas reales de un repo)
- `ingesta/gitlab/test-connection` (POST — verifica conectividad antes de guardar un conector)
- `ingesta/gdrive-catalog` (GET)
- `ingesta/batches` (GET)
- `ingesta/vault/secrets` (GET — lista paths), `ingesta/vault/secrets/[path]` (PUT/DELETE),
  `ingesta/vault/secrets/[path]/metadata` (GET) — **nunca** exponen el valor del secreto, solo
  metadata (path, versión, fecha).

`src/middleware.ts` aplica cabeceras CORS a `/api/ingesta/:path*`, `/api/auth/session` y
`/api/health/:path*` (los orígenes cross-port del shell/MicroUI en desarrollo local necesitan
CORS explícito; `/api/auth/login` y `/api/auth/callback` se excluyen porque solo se alcanzan por
navegación de página completa, nunca `fetch()`).

`src/lib/session.ts` — store de sesión server-side, file-backed (`.session-store.json`,
gitignored) para sobrevivir reinicios del dev server; incluye refresco transparente de tokens
cuando `expiresAt` está próximo a vencer, usando `refreshTokens()` de `src/lib/keycloak.ts`.

## Microservicio `ingestion-api` — dominio

`portal/services/ingestion-api/app/`:

- `main.py` — arma la app FastAPI, monta los routers bajo prefijo `/api/v1`, expone `/health` y
  `/ready` fuera de ese prefijo.
- `core/security.py` — `require_role(*roles)` como dependencia FastAPI; valida el JWT recibido
  contra el JWKS de Keycloak (audiencia deshabilitada por limitación de configuración del realm
  compartido — ver `03-security-and-identity.md`).
- `core/config.py` — `Settings` (pydantic-settings) leído de variables `KM_*` y `.env`.
- `core/vault_client.py` — cliente HashiCorp Vault KV v2 (`list_secrets`, `get_secret_metadata`,
  `get_secret_value` — este último **solo** para uso server-side, nunca expuesto en una respuesta
  HTTP al frontend), con soporte de mount/prefix separados desde `KM_VAULT_KV_PATH`.
- `core/gitlab_client.py` — cliente REST de GitLab real (`search_projects`, `get_project`,
  `list_branches`, `test_connection`), autenticado con el token resuelto de Vault por conector.
- `db/session.py` — store en memoria (catálogo de conectores, vínculos repo/carpeta, batches) —
  **swap pendiente** por un repositorio MySQL real antes de producción (ver comentario en el
  archivo, referencia a la sección 8 del PRD).
- `api/routes_connectors.py` — CRUD de conectores, vínculo de repos/carpetas/esquemas.
- `api/routes_gitlab.py` — búsqueda real de repos GitLab, ramas, test de conectividad (todas
  resuelven el token del conector desde Vault en cada llamada).
- `api/routes_gdrive.py` — catálogo Google Drive (mock hoy).
- `api/routes_vault.py` — CRUD de secretos Vault, gateado a rol `km-admin`.
- `api/routes_batches.py` — batches de ingesta.

Roles (sección 5 del PRD): `km-admin` (todo), `km-curador`, `km-operador`, `km-auditor`
(lectura). Cada endpoint declara sus roles permitidos vía `require_role(...)`.

## Convención de errores

Todo fallo de un servicio externo (Vault, GitLab) se traduce a `HTTPException(503, detail=...)`
desde el backend — nunca un 500 crudo. El frontend (`ingesta-api.service.ts`) propaga ese `detail`
tal cual a la UI (patrón consolidado tras un hallazgo de revisión: los primeros métodos de
búsqueda de GitLab silenciaban el error y mostraban un estado vacío genérico en vez del mensaje
real — ver `docs/superpowers/specs/2026-09-06-gitlab-repos-operativo-design.md`).

## Ejecutar en local

```bash
cd portal/bff && npm install && npm run dev                                    # puerto 3000
cd portal/shell && npm install && npm start                                    # puerto 4200
cd portal/micro-ui-ingesta && npm install && npm start                         # puerto 4201
cd portal/services/ingestion-api && pip install -r requirements.txt \
  && uvicorn app.main:app --reload --port 8001                                 # puerto configurable
```

Variables de entorno clave: `KEYCLOAK_ISSUER`/`KEYCLOAK_CLIENT_ID` (BFF),
`INGESTION_API_URL` (BFF → microservicio), `KM_KEYCLOAK_ISSUER`/`KM_KEYCLOAK_AUDIENCE`
(microservicio), `KM_VAULT_ADDR`/`KM_VAULT_TOKEN`/`KM_VAULT_KV_PATH` (microservicio → Vault).

## Estado conocido / deuda técnica

- El store de `ingestion-api` (`db/session.py`) es en memoria — se pierde en cada reinicio del
  proceso (relevante en desarrollo con `--reload`; bloqueante para producción).
- La verificación de audiencia JWT está deshabilitada (`verify_aud: False`) porque el cliente
  compartido del realm no tiene un audience mapper configurado — ver `03-security-and-identity.md`.
- Google Drive y esquemas de base de datos siguen usando catálogos simulados; solo GitLab tiene
  integración real hoy.
- No hay suite de tests de componente para el MicroUI/Shell (Angular) — el microservicio FastAPI
  sí tiene tests (`pytest`, bajo `services/ingestion-api/tests/`).
