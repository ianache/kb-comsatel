# Gestión operativa de repositorios GitLab — Design Spec

**Date:** 2026-09-06
**Status:** Approved for planning

## Problem

The "Administrar repositorios" screen (`portal/micro-ui-ingesta/src/app/pages/administrar-repositorios/`)
and its backing endpoint (`GET /gitlab/catalog` in `portal/services/ingestion-api/`) are
scaffolding built during the earlier Conectores feature: the catalog of repositories and their
branch lists is a hardcoded, static, in-memory list (`_gitlab_catalog` in
`app/db/session.py`), unrelated to any real GitLab instance. There is no real GitLab API
integration anywhere in the portal.

This spec makes the GitLab connector's repository management fully operational: real search by
repository name or numeric ID against a live GitLab instance, and real per-repository branch
listing, both authenticated with a Personal Access Token stored in Vault (reusing the Vault
integration already built).

## Goals

- Search GitLab projects by name (partial match) or exact numeric ID, on demand — no bulk catalog
  load.
- List real branches for a selected repository, fetched lazily when the user selects it.
- Link selected repositories + chosen branch to a connector (existing linking flow, adapted to
  real search results instead of the static catalog).
- Make "Verificar conectividad" (in the "Nuevo conector" creation panel) perform a real GitLab API
  call instead of the current simulated test.
- Surface GitLab connectivity errors (invalid/expired token, network failure) inline, and mark the
  connector `healthy=false` when a real operation against it fails.

## Non-goals

- Pagination of search results (GitLab's default API page size is accepted for this iteration).
- OAuth-based GitLab authentication — Personal/Project Access Token only, per the existing Vault
  credential pattern.
- Any change to the Google Drive or Database connector flows.
- Real branch listing or search caching/preloading beyond what's specified below.

## Architecture

### Backend: `portal/services/ingestion-api/`

**New `app/core/gitlab_client.py`** — a small async httpx-based client, following the same shape
as `app/core/vault_client.py`:

```python
class GitLabApiError(Exception):
    """Raised for any GitLab API failure (auth, network, not-found)."""

class GitLabClient:
    def __init__(self, base_uri: str, token: str) -> None: ...
    async def search_projects(self, query: str) -> list[dict]: ...   # GET /api/v4/projects?search=
    async def get_project(self, project_id: str) -> dict: ...        # GET /api/v4/projects/:id
    async def list_branches(self, project_id: str) -> list[dict]: ...# GET /api/v4/projects/:id/repository/branches
    async def test_connection(self) -> None: ...                     # GET /user — raises GitLabApiError on failure
```

All methods raise `GitLabApiError` on non-2xx responses or network failure; callers translate this
to an HTTP 503 response, matching the existing `_vault_error` convention in `routes_vault.py`.

**Token resolution.** The frontend never sees secret values (existing rule); the backend does need
the raw token server-side to call GitLab. Add `VaultClient.get_secret_value(path) -> dict[str,
str]` (a genuinely new method — today `VaultClient` only exposes metadata for the frontend-facing
endpoints). A new helper `resolve_gitlab_token(connector: Connector, vault_client: VaultClient) ->
str` reads `connector.vault_secret_ref`, calls `get_secret_value`, and extracts the token field
(convention: the secret's `token` key, matching how "+ Nueva credencial" stores fields as a flat
key/value map).

**`routes_gitlab.py`** replaces the static `/gitlab/catalog` endpoint with:

- `GET /gitlab/connectors/{id}/search?q=<text>` — resolves the connector, builds a `GitLabClient`,
  detects numeric vs. text query, calls `search_projects` or `get_project`, and returns
  `list[GitLabSearchResult]`. Empty/whitespace `q` returns `[]` without calling GitLab.
- `GET /gitlab/connectors/{id}/repos/{repo_id}/branches` — resolves the connector, calls
  `list_branches`, returns `GitLabBranches`.
- `POST /gitlab/test-connection` — body `{base_uri: str, vault_secret_ref: str}`, builds a
  transient `GitLabClient` (no persisted connector needed — used both by "Nuevo conector" during
  creation and any future re-verification), calls `test_connection()`, returns `204` on success or
  `503` with a clear message on failure.

All three endpoints are gated to `km-admin`/`km-auditor` read roles, consistent with
`routes_gitlab.py`'s current `_READ_ROLES`, except `test-connection` which is `km-admin` only
(mutating intent: verifying before a save).

On any GitLab failure reached through a connector-scoped endpoint (`search`, `branches`), the
handler also calls `update_connector(connector_id, healthy=False)` before returning the 503, so
the "Conectores y Fuentes" list reflects the failure. A successful call does the inverse
(`healthy=True`) if the connector was previously marked unhealthy.

**`app/db/session.py`** — remove `_gitlab_catalog` and `list_gitlab_catalog()` entirely. Keep
`_repo_links`, `list_repo_links()`, and `link_gitlab_repos()`, but `link_gitlab_repos` no longer
validates repo IDs against a static catalog — it trusts the `repo_id`/`repo_name` pairs the
frontend already fetched via `search`/`branches` and passes through at link time (see payload
change below).

**`app/models/schemas.py`** — remove `GitLabCatalogEntry`. Add:

```python
class GitLabSearchResult(BaseModel):
    id: str
    nombre: str
    grupo: str

class GitLabBranches(BaseModel):
    ramas_disponibles: list[str]
    rama_default: str

class GitLabTestConnectionRequest(BaseModel):
    base_uri: str
    vault_secret_ref: str

class LinkGitlabReposRequest(BaseModel):
    repos: list[GitLabRepoSelection]  # replaces the old repo_ids + branch_by_id shape

class GitLabRepoSelection(BaseModel):
    repo_id: str
    repo_name: str
    grupo: str
    rama: str
```

`GitLabRepoLink` is unchanged.

### Frontend: `portal/micro-ui-ingesta/`

**`ingesta-api.service.ts`** — replace `listGitlabCatalog()` with:

```typescript
searchGitlabRepos(connectorId: string, query: string): Promise<GitLabSearchResult[]>
getGitlabBranches(connectorId: string, repoId: string): Promise<GitLabBranches>
testGitlabConnection(baseUri: string, vaultSecretRef: string): Promise<void>  // throws on failure
```

`linkGitlabRepos` signature changes from `(connectorId, repoIds, branchById)` to
`(connectorId, selections: GitLabRepoSelection[])` to carry `repo_name`/`grupo` along (no longer
resolvable server-side from a static catalog).

**`administrar-repositorios.component.ts`** — rewritten:

- Search input (debounced 300ms via a simple `setTimeout` debounce — no new dependency) replaces
  the static-filter input. Empty query clears results; non-empty triggers
  `searchGitlabRepos(connectorId, query)`.
- Results table: ID, Nombre, Grupo, checkbox. No inline branch `<select>` at search time.
- On checkbox check (not uncheck): call `getGitlabBranches(connectorId, repoId)`; while pending,
  show "Cargando ramas…" in that row's branch cell; on resolve, render a `<select>` defaulting to
  `rama_default`; on failure, show an inline error in that row and leave the repo unselected
  (auto-uncheck).
  - **Note (design decision, no user input needed — reversible, low-risk):** if the branches call
    fails, the row's checkbox is programmatically unchecked so "Añadir seleccionados" never sends
    an incomplete selection. This is a UI-only behavior fully contained in this file.
- "Añadir seleccionados" builds `GitLabRepoSelection[]` from selected rows (id, nombre, grupo,
  chosen branch) and calls the updated `linkGitlabRepos`.
- A page-level error banner (e.g. "No se pudo conectar a GitLab: token inválido o expirado")
  appears when a search or branches call returns a 503, sourced from the response body's `detail`.

**"Nuevo conector" panel (`conectores.component.ts`)** — "Verificar conectividad" (gitlab kind
only) calls `testGitlabConnection(form.base_uri, form.vault_secret_ref)` instead of the current
simulated `setTimeout`; shows the same pending/success/failure states already wired, driven by the
real call's resolve/reject.

### BFF proxy routes (`portal/bff/`)

Replace `src/app/api/ingesta/gitlab-catalog/route.ts` with:

- `src/app/api/ingesta/gitlab/[id]/search/route.ts` (GET, forwards `?q=`)
- `src/app/api/ingesta/gitlab/[id]/branches/[repoId]/route.ts` (GET)
- `src/app/api/ingesta/gitlab/test-connection/route.ts` (POST)

Same proxy pattern as existing routes (inject bearer token server-side, forward to
`INGESTION_API_URL`). `middleware.ts`'s CORS matcher (`/api/ingesta/:path*`) already covers these
new paths with no changes needed; `Access-Control-Allow-Methods` already includes GET/POST.

### Error handling summary

| Failure | Backend behavior | Frontend behavior |
|---|---|---|
| Vault secret missing/unreadable | `GitLabApiError`-equivalent 503 from token resolution | Inline banner: "No se pudo obtener la credencial del conector" |
| GitLab 401 (bad/expired token) | 503, connector `healthy=False` | Inline banner: "No se pudo conectar a GitLab: token inválido o expirado" |
| GitLab network/timeout | 503, connector `healthy=False` | Inline banner: "No se pudo conectar a GitLab: error de red" |
| GitLab 404 on search-by-ID | 200 with empty result list (not an error — "no matches") | "Ningún repositorio coincide con el filtro." (existing empty state) |

### Testing

- Backend: unit tests for `gitlab_client.py` against a mocked httpx transport (success, 401, 404,
  timeout) — mirrors how `vault_client.py` would be tested. Route-level tests for
  `routes_gitlab.py` verifying role gating, numeric-vs-text query dispatch, and the
  `healthy` flip on failure.
- Frontend: no existing test harness for `micro-ui-ingesta` components in this repo (consistent
  with the rest of the Conectores/Vault features, which shipped without component tests) — manual
  verification via the running dev stack, per this session's established workflow.

## Open questions

None — all decisions confirmed during brainstorming.
