# Gestión operativa de repositorios GitLab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded GitLab repository catalog with real search-by-name/ID and
real per-repository branch listing against a live GitLab instance, authenticated via the
connector's Vault-stored Personal Access Token.

**Architecture:** A new `GitLabClient` (httpx-based, mirrors the existing `VaultClient` pattern)
talks to GitLab's REST API. `routes_gitlab.py` gains three endpoints (search, branches,
test-connection) that resolve a connector's token from Vault via a new `VaultClient.get_secret_value`
method, then call `GitLabClient`. The Angular "Administrar repositorios" screen switches from a
static full-catalog table to debounced search-on-demand with lazy per-row branch loading. The BFF
gains matching proxy routes.

**Tech Stack:** FastAPI + httpx + pydantic (backend), Angular 18 standalone components (frontend),
Next.js route handlers (BFF proxy).

**Spec:** `docs/superpowers/specs/2026-09-06-gitlab-repos-operativo-design.md`

## Global Constraints

- Never expose Vault secret *values* to the frontend — only the backend (ingestion-api) may read
  `VaultClient.get_secret_value`; the BFF and Angular layers never see a raw token.
- Personal/Project Access Token auth only — no OAuth flow for GitLab in this iteration.
- No pagination of GitLab search results in this iteration (GitLab's default API page size is
  accepted as-is).
- All new/changed ingestion-api endpoints stay gated by `require_role(...)` exactly as existing
  endpoints are — `_READ_ROLES = ("km-admin", "km-auditor")` for reads, `_WRITE_ROLES =
  ("km-admin",)` for writes and the connectivity test.
- Every GitLab API failure surfaced through a connector-scoped endpoint (search, branches) must
  flip that connector's `healthy` field to `False`; a subsequent successful call flips it back to
  `True`.
- Follow the existing error convention: GitLab/Vault failures raise `HTTPException(503, detail=...)`
  from route handlers — never a bare 500.

---

### Task 1: `VaultClient.get_secret_value` — server-side secret value retrieval

**Files:**
- Modify: `portal/services/ingestion-api/app/core/vault_client.py`
- Test: `portal/services/ingestion-api/tests/core/test_vault_client.py` (new file; `tests/` and
  `tests/core/` directories do not exist yet — create them)

**Interfaces:**
- Consumes: nothing new (uses the existing `VaultClient.__init__(settings)`, `self._addr`,
  `self._mount`, `self._prefix`, `self._headers`, `self._secret_path(path)` already in the file).
- Produces: `async def get_secret_value(self, path: str) -> dict[str, str]` on `VaultClient` —
  returns the raw KV v2 data map (e.g. `{"token": "glpat-..."}`). Task 4 depends on this exact
  signature.

This is the **only** place in the codebase allowed to read a secret's actual value (as opposed to
metadata) — it exists so the backend can authenticate to GitLab on the connector's behalf, never so
a value reaches the frontend.

- [ ] **Step 1: Write the failing test**

Create `portal/services/ingestion-api/tests/__init__.py` (empty file) and
`portal/services/ingestion-api/tests/core/__init__.py` (empty file), then
`portal/services/ingestion-api/tests/core/test_vault_client.py`:

```python
import httpx
import pytest

from app.core.config import Settings
from app.core.vault_client import VaultClient


def _settings(**overrides: object) -> Settings:
    defaults = {
        "vault_addr": "http://vault.test:8200",
        "vault_token": "test-token",
        "vault_kv_path": "secret/kb",
    }
    defaults.update(overrides)
    return Settings(**defaults)


@pytest.mark.asyncio
async def test_get_secret_value_returns_data_map() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/secret/data/kb/gitlab"
        assert request.headers["X-Vault-Token"] == "test-token"
        return httpx.Response(200, json={"data": {"data": {"token": "glpat-abc123"}, "metadata": {}}})

    client = VaultClient(_settings())
    client._transport = httpx.MockTransport(handler)  # patched in Step 3

    result = await client.get_secret_value("gitlab")
    assert result == {"token": "glpat-abc123"}
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `portal/services/ingestion-api/`):
`.venv/Scripts/python.exe -m pytest tests/core/test_vault_client.py -v`
Expected: FAIL with `AttributeError: 'VaultClient' object has no attribute 'get_secret_value'`

- [ ] **Step 3: Make `VaultClient` use an injectable transport, and add `get_secret_value`**

`VaultClient` currently constructs a fresh `httpx.AsyncClient(timeout=10.0)` inline in every
method, which cannot be intercepted by `httpx.MockTransport` in tests. Add an optional
`_transport` attribute, defaulting to `None` (real network), and thread it through every
`httpx.AsyncClient(...)` construction. Edit
`portal/services/ingestion-api/app/core/vault_client.py`:

```python
import httpx

from app.core.config import Settings


class VaultNotConfiguredError(Exception):
    """Raised when KM_VAULT_TOKEN is not set — callers should return 503."""


class VaultClient:
    def __init__(self, settings: Settings) -> None:
        if not settings.vault_token:
            raise VaultNotConfiguredError("KM_VAULT_TOKEN no configurado")
        self._addr = settings.vault_addr.rstrip("/")
        # KV v2 URL shape is /v1/<mount>/data|metadata/<secret-path>. The
        # configured KM_VAULT_KV_PATH (e.g. "secrets/kb") is the *engine
        # mount* ("secrets") followed by a fixed sub-path prefix ("kb")
        # under which all this portal's secrets live — not itself a mount.
        kv_path = settings.vault_kv_path.strip("/")
        mount, _, prefix = kv_path.partition("/")
        self._mount = mount
        self._prefix = prefix
        self._headers = {"X-Vault-Token": settings.vault_token}
        self._transport: httpx.BaseTransport | None = None

    def _secret_path(self, path: str) -> str:
        return f"{self._prefix}/{path}" if self._prefix else path

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=10.0, transport=self._transport)

    async def list_secrets(self) -> list[str]:
        url = f"{self._addr}/v1/{self._mount}/metadata/{self._prefix}".rstrip("/")
        async with self._client() as client:
            response = await client.request("LIST", url, headers=self._headers)
        if response.status_code == 404:
            return []
        response.raise_for_status()
        return response.json()["data"]["keys"]

    async def get_secret_metadata(self, path: str) -> dict:
        url = f"{self._addr}/v1/{self._mount}/metadata/{self._secret_path(path)}"
        async with self._client() as client:
            response = await client.get(url, headers=self._headers)
        response.raise_for_status()
        data = response.json()["data"]
        return {
            "path": path,
            "current_version": data.get("current_version"),
            "updated_time": data.get("versions", {})
            .get(str(data.get("current_version")), {})
            .get("created_time"),
        }

    async def get_secret_value(self, path: str) -> dict[str, str]:
        """Return the raw secret data map. Server-side use only — never expose to the frontend."""
        url = f"{self._addr}/v1/{self._mount}/data/{self._secret_path(path)}"
        async with self._client() as client:
            response = await client.get(url, headers=self._headers)
        response.raise_for_status()
        return response.json()["data"]["data"]

    async def write_secret(self, path: str, data: dict[str, str]) -> None:
        url = f"{self._addr}/v1/{self._mount}/data/{self._secret_path(path)}"
        async with self._client() as client:
            response = await client.post(url, headers=self._headers, json={"data": data})
        response.raise_for_status()

    async def delete_secret(self, path: str) -> None:
        url = f"{self._addr}/v1/{self._mount}/metadata/{self._secret_path(path)}"
        async with self._client() as client:
            response = await client.delete(url, headers=self._headers)
        if response.status_code not in (204, 404):
            response.raise_for_status()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/Scripts/python.exe -m pytest tests/core/test_vault_client.py -v`
Expected: PASS

- [ ] **Step 5: Add `pytest-asyncio` config so `@pytest.mark.asyncio` works without extra flags**

Add to `portal/services/ingestion-api/pyproject.toml`, after the `[project.optional-dependencies]`
block:

```toml
[tool.pytest.ini_options]
asyncio_mode = "auto"
```

Re-run: `.venv/Scripts/python.exe -m pytest tests/core/test_vault_client.py -v` — expected: PASS
(this makes the `@pytest.mark.asyncio` decorator redundant but harmless; leave it in place for
clarity).

- [ ] **Step 6: Commit**

```bash
git add portal/services/ingestion-api/app/core/vault_client.py portal/services/ingestion-api/tests/__init__.py portal/services/ingestion-api/tests/core/__init__.py portal/services/ingestion-api/tests/core/test_vault_client.py portal/services/ingestion-api/pyproject.toml
git commit -m "feat(ingestion-api): add VaultClient.get_secret_value for server-side token resolution"
```

---

### Task 2: `GitLabClient` — GitLab REST API client

**Files:**
- Create: `portal/services/ingestion-api/app/core/gitlab_client.py`
- Test: `portal/services/ingestion-api/tests/core/test_gitlab_client.py` (new)

**Interfaces:**
- Consumes: nothing from earlier tasks (standalone httpx client, same shape as `VaultClient`).
- Produces (used by Task 4):
  ```python
  class GitLabApiError(Exception): ...

  class GitLabClient:
      def __init__(self, base_uri: str, token: str) -> None: ...
      async def search_projects(self, query: str) -> list[dict]: ...
      async def get_project(self, project_id: str) -> dict | None: ...
      async def list_branches(self, project_id: str) -> list[dict]: ...
      async def test_connection(self) -> None: ...
  ```
  Each GitLab project dict has at least `id` (int), `path_with_namespace` (str),
  `namespace: {"full_path": str}`. Each branch dict has at least `name` (str) and
  `default` (bool).

- [ ] **Step 1: Write the failing test**

Create `portal/services/ingestion-api/tests/core/test_gitlab_client.py`:

```python
import httpx
import pytest

from app.core.gitlab_client import GitLabApiError, GitLabClient


def _client(handler) -> GitLabClient:
    client = GitLabClient(base_uri="https://gitlab.internal.comsatel.pe", token="glpat-abc123")
    client._transport = httpx.MockTransport(handler)
    return client


@pytest.mark.asyncio
async def test_search_projects_calls_search_endpoint() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/v4/projects"
        assert request.url.params["search"] == "gps-core"
        assert request.headers["PRIVATE-TOKEN"] == "glpat-abc123"
        return httpx.Response(
            200,
            json=[
                {
                    "id": 4892,
                    "path_with_namespace": "telemetry/gps-core",
                    "namespace": {"full_path": "telemetry"},
                }
            ],
        )

    client = _client(handler)
    result = await client.search_projects("gps-core")
    assert result == [{"id": 4892, "path_with_namespace": "telemetry/gps-core", "namespace": {"full_path": "telemetry"}}]


@pytest.mark.asyncio
async def test_get_project_by_id() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/v4/projects/4892"
        return httpx.Response(
            200,
            json={"id": 4892, "path_with_namespace": "telemetry/gps-core", "namespace": {"full_path": "telemetry"}},
        )

    client = _client(handler)
    result = await client.get_project("4892")
    assert result is not None
    assert result["id"] == 4892


@pytest.mark.asyncio
async def test_get_project_returns_none_on_404() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"message": "404 Project Not Found"})

    client = _client(handler)
    result = await client.get_project("999999")
    assert result is None


@pytest.mark.asyncio
async def test_list_branches() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/v4/projects/4892/repository/branches"
        return httpx.Response(
            200,
            json=[
                {"name": "main", "default": True},
                {"name": "develop", "default": False},
            ],
        )

    client = _client(handler)
    result = await client.list_branches("4892")
    assert result == [{"name": "main", "default": True}, {"name": "develop", "default": False}]


@pytest.mark.asyncio
async def test_search_projects_raises_on_401() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"message": "401 Unauthorized"})

    client = _client(handler)
    with pytest.raises(GitLabApiError):
        await client.search_projects("anything")


@pytest.mark.asyncio
async def test_test_connection_raises_on_failure() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/v4/user"
        return httpx.Response(401, json={"message": "401 Unauthorized"})

    client = _client(handler)
    with pytest.raises(GitLabApiError):
        await client.test_connection()


@pytest.mark.asyncio
async def test_test_connection_succeeds() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"username": "svc-portal-km"})

    client = _client(handler)
    await client.test_connection()  # must not raise
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/Scripts/python.exe -m pytest tests/core/test_gitlab_client.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.core.gitlab_client'`

- [ ] **Step 3: Write the implementation**

Create `portal/services/ingestion-api/app/core/gitlab_client.py`:

```python
import httpx


class GitLabApiError(Exception):
    """Raised for any GitLab API failure (auth, network, unexpected status)."""


class GitLabClient:
    def __init__(self, base_uri: str, token: str) -> None:
        self._base = base_uri.rstrip("/")
        self._headers = {"PRIVATE-TOKEN": token}
        self._transport: httpx.BaseTransport | None = None

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=10.0, transport=self._transport)

    async def search_projects(self, query: str) -> list[dict]:
        url = f"{self._base}/api/v4/projects"
        try:
            async with self._client() as client:
                response = await client.get(url, headers=self._headers, params={"search": query})
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise GitLabApiError(str(exc)) from exc
        return response.json()

    async def get_project(self, project_id: str) -> dict | None:
        url = f"{self._base}/api/v4/projects/{project_id}"
        try:
            async with self._client() as client:
                response = await client.get(url, headers=self._headers)
            if response.status_code == 404:
                return None
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise GitLabApiError(str(exc)) from exc
        return response.json()

    async def list_branches(self, project_id: str) -> list[dict]:
        url = f"{self._base}/api/v4/projects/{project_id}/repository/branches"
        try:
            async with self._client() as client:
                response = await client.get(url, headers=self._headers)
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise GitLabApiError(str(exc)) from exc
        return response.json()

    async def test_connection(self) -> None:
        url = f"{self._base}/api/v4/user"
        try:
            async with self._client() as client:
                response = await client.get(url, headers=self._headers)
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise GitLabApiError(str(exc)) from exc
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/Scripts/python.exe -m pytest tests/core/test_gitlab_client.py -v`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add portal/services/ingestion-api/app/core/gitlab_client.py portal/services/ingestion-api/tests/core/test_gitlab_client.py
git commit -m "feat(ingestion-api): add GitLabClient for real project search/branch/connectivity calls"
```

---

### Task 3: Data model & in-memory store updates

**Files:**
- Modify: `portal/services/ingestion-api/app/models/schemas.py`
- Modify: `portal/services/ingestion-api/app/db/session.py`
- Test: `portal/services/ingestion-api/tests/db/test_session_gitlab.py` (new; create
  `tests/db/__init__.py` too)

**Interfaces:**
- Consumes: `GitLabRepoLink` (unchanged, from `schemas.py`).
- Produces (used by Tasks 4 and 5):
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

  class GitLabRepoSelection(BaseModel):
      repo_id: str
      repo_name: str
      grupo: str
      rama: str

  class LinkGitlabReposRequest(BaseModel):
      repos: list[GitLabRepoSelection]
  ```
  `db/session.py` produces:
  `def link_gitlab_repos(connector_id: str, selections: list[GitLabRepoSelection]) -> list[GitLabRepoLink]`
  (replaces the old `(connector_id, repo_ids, branch_by_id)` signature). `list_gitlab_catalog` and
  `_gitlab_catalog` are removed entirely — Task 4's live search replaces them.

- [ ] **Step 1: Write the failing test**

Create `portal/services/ingestion-api/tests/db/__init__.py` (empty) and
`portal/services/ingestion-api/tests/db/test_session_gitlab.py`:

```python
from app.db.session import link_gitlab_repos, list_repo_links
from app.models.schemas import GitLabRepoSelection


def test_link_gitlab_repos_creates_links_from_selections() -> None:
    selections = [
        GitLabRepoSelection(repo_id="4892", repo_name="telemetry/gps-core", grupo="telemetry", rama="main"),
    ]
    created = link_gitlab_repos("test-connector-1", selections)
    assert len(created) == 1
    assert created[0].repo == "telemetry/gps-core"
    assert created[0].repo_id == "4892"
    assert created[0].rama == "main"

    linked = list_repo_links("test-connector-1")
    assert any(link.repo_id == "4892" for link in linked)


def test_link_gitlab_repos_skips_already_linked() -> None:
    selections = [
        GitLabRepoSelection(repo_id="5012", repo_name="core-api/gateway", grupo="core-api", rama="master"),
    ]
    first = link_gitlab_repos("test-connector-2", selections)
    assert len(first) == 1

    second = link_gitlab_repos("test-connector-2", selections)
    assert len(second) == 0  # already linked, no duplicate created
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/Scripts/python.exe -m pytest tests/db/test_session_gitlab.py -v`
Expected: FAIL with `ImportError: cannot import name 'GitLabRepoSelection' from 'app.models.schemas'`

- [ ] **Step 3: Update `schemas.py`**

In `portal/services/ingestion-api/app/models/schemas.py`, replace lines 40-61 (the
`GitLabCatalogEntry`, `GitLabRepoLink`, `LinkGitlabReposRequest` block) with:

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


class GitLabRepoLink(BaseModel):
    id: str
    connector_id: str
    repo: str
    repo_id: str
    rama: str
    ruta: str = "/"
    auto_sync: bool = True
    estado: str = "Sincronizado"


class GitLabRepoSelection(BaseModel):
    repo_id: str
    repo_name: str
    grupo: str
    rama: str


class LinkGitlabReposRequest(BaseModel):
    repos: list[GitLabRepoSelection]
```

- [ ] **Step 4: Update `db/session.py`**

In `portal/services/ingestion-api/app/db/session.py`:

1. Update the import block (lines 10-20) — remove `GitLabCatalogEntry`, add
   `GitLabRepoSelection`:

```python
from app.models.schemas import (
    BatchStatus,
    Connector,
    ConnectorKind,
    DriveCatalogEntry,
    DriveFolderLink,
    GitLabRepoLink,
    GitLabRepoSelection,
    IngestionBatch,
    SchemaTable,
)
```

2. Replace lines 105-143 (the `_gitlab_catalog` list through the old `link_gitlab_repos`) with:

```python
_repo_links: dict[str, GitLabRepoLink] = {}


def list_repo_links(connector_id: str) -> list[GitLabRepoLink]:
    return [link for link in _repo_links.values() if link.connector_id == connector_id]


def link_gitlab_repos(connector_id: str, selections: list[GitLabRepoSelection]) -> list[GitLabRepoLink]:
    already_linked = {link.repo_id for link in _repo_links.values() if link.connector_id == connector_id}
    created: list[GitLabRepoLink] = []
    for selection in selections:
        if selection.repo_id in already_linked:
            continue
        link_id = f"rl-{connector_id}-{selection.repo_id}"
        link = GitLabRepoLink(
            id=link_id,
            connector_id=connector_id,
            repo=selection.repo_name,
            repo_id=selection.repo_id,
            rama=selection.rama,
        )
        _repo_links[link_id] = link
        created.append(link)
    return created
```

- [ ] **Step 5: Run test to verify it passes**

Run: `.venv/Scripts/python.exe -m pytest tests/db/test_session_gitlab.py -v`
Expected: PASS (2 tests)

- [ ] **Step 6: Run the full test suite to confirm nothing else broke**

Run: `.venv/Scripts/python.exe -m pytest -v`
Expected: all tests PASS (this will fail at this point only if a later task's route file already
references the removed `GitLabCatalogEntry`/`list_gitlab_catalog` — it does not yet, since Task 4
hasn't run; if `routes_gitlab.py` fails to import, that's fine to leave broken until Task 4 fixes
it in the same work session — but do check the failure is exactly that import, nothing else)

- [ ] **Step 7: Commit**

```bash
git add portal/services/ingestion-api/app/models/schemas.py portal/services/ingestion-api/app/db/session.py portal/services/ingestion-api/tests/db/__init__.py portal/services/ingestion-api/tests/db/test_session_gitlab.py
git commit -m "refactor(ingestion-api): replace static GitLab catalog model with search-result/branches/selection schemas"
```

---

### Task 4: `routes_gitlab.py` — search, branches, test-connection endpoints

**Files:**
- Modify: `portal/services/ingestion-api/app/api/routes_gitlab.py`
- Test: `portal/services/ingestion-api/tests/api/test_routes_gitlab.py` (new; create
  `tests/api/__init__.py`)
- Test fixtures: `portal/services/ingestion-api/tests/conftest.py` (new)

**Interfaces:**
- Consumes: `VaultClient` + `VaultClient.get_secret_value` (Task 1), `GitLabClient` +
  `GitLabApiError` (Task 2), `GitLabSearchResult`/`GitLabBranches`/`GitLabTestConnectionRequest`
  (Task 3), `update_connector`/`get_connector` (existing, `app/db/session.py`), `require_role`
  (existing, `app/core/security.py`).
- Produces (used by Task 5's BFF proxy and the frontend, via HTTP):
  - `GET /api/v1/gitlab/connectors/{connector_id}/search?q=<text>` → `list[GitLabSearchResult]`
  - `GET /api/v1/gitlab/connectors/{connector_id}/repos/{repo_id}/branches` → `GitLabBranches`
  - `POST /api/v1/gitlab/test-connection` (body: `GitLabTestConnectionRequest`) → `204 No Content`
    on success, `503` on failure

- [ ] **Step 1: Write the failing tests**

Create `portal/services/ingestion-api/tests/conftest.py`:

```python
import pytest
from fastapi.testclient import TestClient

from app.core.security import Principal, get_current_principal
from app.main import app


@pytest.fixture
def admin_client() -> TestClient:
    app.dependency_overrides[get_current_principal] = lambda: Principal(
        subject="test-admin", roles=["km-admin"], claims={}
    )
    client = TestClient(app)
    yield client
    app.dependency_overrides.clear()
```

Create `portal/services/ingestion-api/tests/api/__init__.py` (empty), then
`portal/services/ingestion-api/tests/api/test_routes_gitlab.py`:

```python
from unittest.mock import AsyncMock, patch

from app.core.gitlab_client import GitLabApiError
from app.db.session import _connectors
from app.models.schemas import Connector, ConnectorKind


def _seed_gitlab_connector() -> None:
    _connectors["gl-test"] = Connector(
        id="gl-test",
        kind=ConnectorKind.gitlab,
        name="GitLab Test",
        base_uri="https://gitlab.test",
        vault_secret_ref="secrets/kb/gitlab-test",
    )


def test_search_by_text_calls_search_projects(admin_client) -> None:
    _seed_gitlab_connector()
    with (
        patch("app.api.routes_gitlab.VaultClient") as mock_vault_cls,
        patch("app.api.routes_gitlab.GitLabClient") as mock_gitlab_cls,
    ):
        mock_vault_cls.return_value.get_secret_value = AsyncMock(return_value={"token": "glpat-x"})
        mock_gitlab_cls.return_value.search_projects = AsyncMock(
            return_value=[{"id": 4892, "path_with_namespace": "telemetry/gps-core", "namespace": {"full_path": "telemetry"}}]
        )

        response = admin_client.get("/api/v1/gitlab/connectors/gl-test/search", params={"q": "gps-core"})

        assert response.status_code == 200
        assert response.json() == [{"id": "4892", "nombre": "telemetry/gps-core", "grupo": "telemetry"}]
        mock_gitlab_cls.return_value.search_projects.assert_awaited_once_with("gps-core")


def test_search_by_numeric_id_calls_get_project(admin_client) -> None:
    _seed_gitlab_connector()
    with (
        patch("app.api.routes_gitlab.VaultClient") as mock_vault_cls,
        patch("app.api.routes_gitlab.GitLabClient") as mock_gitlab_cls,
    ):
        mock_vault_cls.return_value.get_secret_value = AsyncMock(return_value={"token": "glpat-x"})
        mock_gitlab_cls.return_value.get_project = AsyncMock(
            return_value={"id": 4892, "path_with_namespace": "telemetry/gps-core", "namespace": {"full_path": "telemetry"}}
        )

        response = admin_client.get("/api/v1/gitlab/connectors/gl-test/search", params={"q": "4892"})

        assert response.status_code == 200
        assert response.json() == [{"id": "4892", "nombre": "telemetry/gps-core", "grupo": "telemetry"}]
        mock_gitlab_cls.return_value.get_project.assert_awaited_once_with("4892")


def test_search_empty_query_returns_empty_without_calling_gitlab(admin_client) -> None:
    _seed_gitlab_connector()
    with patch("app.api.routes_gitlab.GitLabClient") as mock_gitlab_cls:
        response = admin_client.get("/api/v1/gitlab/connectors/gl-test/search", params={"q": "   "})
        assert response.status_code == 200
        assert response.json() == []
        mock_gitlab_cls.assert_not_called()


def test_search_failure_marks_connector_unhealthy(admin_client) -> None:
    _seed_gitlab_connector()
    with (
        patch("app.api.routes_gitlab.VaultClient") as mock_vault_cls,
        patch("app.api.routes_gitlab.GitLabClient") as mock_gitlab_cls,
    ):
        mock_vault_cls.return_value.get_secret_value = AsyncMock(return_value={"token": "glpat-x"})
        mock_gitlab_cls.return_value.search_projects = AsyncMock(side_effect=GitLabApiError("401 Unauthorized"))

        response = admin_client.get("/api/v1/gitlab/connectors/gl-test/search", params={"q": "gps-core"})

        assert response.status_code == 503
        assert _connectors["gl-test"].healthy is False


def test_branches_endpoint_returns_default_and_list(admin_client) -> None:
    _seed_gitlab_connector()
    with (
        patch("app.api.routes_gitlab.VaultClient") as mock_vault_cls,
        patch("app.api.routes_gitlab.GitLabClient") as mock_gitlab_cls,
    ):
        mock_vault_cls.return_value.get_secret_value = AsyncMock(return_value={"token": "glpat-x"})
        mock_gitlab_cls.return_value.list_branches = AsyncMock(
            return_value=[{"name": "develop", "default": False}, {"name": "main", "default": True}]
        )

        response = admin_client.get("/api/v1/gitlab/connectors/gl-test/repos/4892/branches")

        assert response.status_code == 200
        assert response.json() == {"ramas_disponibles": ["develop", "main"], "rama_default": "main"}


def test_test_connection_success(admin_client) -> None:
    with (
        patch("app.api.routes_gitlab.VaultClient") as mock_vault_cls,
        patch("app.api.routes_gitlab.GitLabClient") as mock_gitlab_cls,
    ):
        mock_vault_cls.return_value.get_secret_value = AsyncMock(return_value={"token": "glpat-x"})
        mock_gitlab_cls.return_value.test_connection = AsyncMock(return_value=None)

        response = admin_client.post(
            "/api/v1/gitlab/test-connection",
            json={"base_uri": "https://gitlab.test", "vault_secret_ref": "secrets/kb/gitlab-test"},
        )

        assert response.status_code == 204


def test_test_connection_failure(admin_client) -> None:
    with (
        patch("app.api.routes_gitlab.VaultClient") as mock_vault_cls,
        patch("app.api.routes_gitlab.GitLabClient") as mock_gitlab_cls,
    ):
        mock_vault_cls.return_value.get_secret_value = AsyncMock(return_value={"token": "glpat-x"})
        mock_gitlab_cls.return_value.test_connection = AsyncMock(side_effect=GitLabApiError("401 Unauthorized"))

        response = admin_client.post(
            "/api/v1/gitlab/test-connection",
            json={"base_uri": "https://gitlab.test", "vault_secret_ref": "secrets/kb/gitlab-test"},
        )

        assert response.status_code == 503
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `portal/services/ingestion-api/`):
`.venv/Scripts/python.exe -m pytest tests/api/test_routes_gitlab.py -v`
Expected: FAIL — `/search`, `/branches`, `/test-connection` endpoints don't exist yet (404s), and
`app.api.routes_gitlab.GitLabClient`/`VaultClient` aren't imported there yet (patch target errors).

- [ ] **Step 3: Write the implementation**

Replace the full contents of `portal/services/ingestion-api/app/api/routes_gitlab.py`:

```python
from fastapi import APIRouter, Depends, HTTPException, status

from app.core.config import Settings, get_settings
from app.core.gitlab_client import GitLabApiError, GitLabClient
from app.core.security import Principal, require_role
from app.core.vault_client import VaultClient, VaultNotConfiguredError
from app.db.session import get_connector, update_connector
from app.models.schemas import Connector, GitLabBranches, GitLabSearchResult, GitLabTestConnectionRequest

router = APIRouter(prefix="/gitlab", tags=["gitlab"])

_READ_ROLES = ("km-admin", "km-auditor")
_WRITE_ROLES = ("km-admin",)


def _require_connector(connector_id: str) -> Connector:
    connector = get_connector(connector_id)
    if connector is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conector no encontrado")
    return connector


async def _resolve_token(vault_secret_ref: str, settings: Settings) -> str:
    try:
        vault_client = VaultClient(settings)
        secret = await vault_client.get_secret_value(vault_secret_ref.removeprefix(f"{settings.vault_kv_path.strip('/')}/"))
        token = secret.get("token")
        if not token:
            raise GitLabApiError("El secreto de Vault no contiene un campo 'token'")
        return token
    except VaultNotConfiguredError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=f"No se pudo leer la credencial de Vault: {exc}") from exc


def _project_to_search_result(project: dict) -> GitLabSearchResult:
    return GitLabSearchResult(
        id=str(project["id"]),
        nombre=project["path_with_namespace"],
        grupo=project.get("namespace", {}).get("full_path", ""),
    )


@router.get("/connectors/{connector_id}/search", response_model=list[GitLabSearchResult])
async def search_repos(
    connector_id: str,
    q: str = "",
    _principal: Principal = Depends(require_role(*_READ_ROLES)),
    settings: Settings = Depends(get_settings),
) -> list[GitLabSearchResult]:
    query = q.strip()
    if not query:
        return []

    connector = _require_connector(connector_id)
    token = await _resolve_token(connector.vault_secret_ref, settings)
    client = GitLabClient(base_uri=connector.base_uri, token=token)

    try:
        if query.isdigit():
            project = await client.get_project(query)
            projects = [project] if project is not None else []
        else:
            projects = await client.search_projects(query)
    except GitLabApiError as exc:
        update_connector(connector_id, healthy=False)
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=f"No se pudo conectar a GitLab: {exc}") from exc

    if not connector.healthy:
        update_connector(connector_id, healthy=True)
    return [_project_to_search_result(project) for project in projects]


@router.get("/connectors/{connector_id}/repos/{repo_id}/branches", response_model=GitLabBranches)
async def get_repo_branches(
    connector_id: str,
    repo_id: str,
    _principal: Principal = Depends(require_role(*_READ_ROLES)),
    settings: Settings = Depends(get_settings),
) -> GitLabBranches:
    connector = _require_connector(connector_id)
    token = await _resolve_token(connector.vault_secret_ref, settings)
    client = GitLabClient(base_uri=connector.base_uri, token=token)

    try:
        branches = await client.list_branches(repo_id)
    except GitLabApiError as exc:
        update_connector(connector_id, healthy=False)
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=f"No se pudo conectar a GitLab: {exc}") from exc

    if not connector.healthy:
        update_connector(connector_id, healthy=True)

    names = [branch["name"] for branch in branches]
    default = next((branch["name"] for branch in branches if branch.get("default")), names[0] if names else "")
    return GitLabBranches(ramas_disponibles=names, rama_default=default)


@router.post("/test-connection", status_code=status.HTTP_204_NO_CONTENT)
async def test_connection(
    body: GitLabTestConnectionRequest,
    _principal: Principal = Depends(require_role(*_WRITE_ROLES)),
    settings: Settings = Depends(get_settings),
) -> None:
    token = await _resolve_token(body.vault_secret_ref, settings)
    client = GitLabClient(base_uri=body.base_uri, token=token)
    try:
        await client.test_connection()
    except GitLabApiError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=f"No se pudo conectar a GitLab: {exc}") from exc
```

**Note on `_resolve_token`:** `vault_secret_ref` is stored as a full path like
`secrets/kb/gitlab` (see `db/session.py`'s seed data and the "Nuevo conector" panel's placeholder
`secrets/kb/gitlab`), while `VaultClient.get_secret_value(path)` expects a path *relative to* the
configured `KM_VAULT_KV_PATH` prefix (mirroring how `routes_vault.py`'s existing endpoints already
receive a bare `path` from the frontend, per the Vault feature's own routes). The
`.removeprefix(...)` call strips the configured prefix so a `vault_secret_ref` of
`secrets/kb/gitlab` with `KM_VAULT_KV_PATH=secret/kb` resolves to `gitlab`. If a connector's
`vault_secret_ref` doesn't start with the configured prefix, `removeprefix` is a no-op and the
full stored value is used as the path verbatim — this is a reasonable fallback, not a bug to fix
here.

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/Scripts/python.exe -m pytest tests/api/test_routes_gitlab.py -v`
Expected: PASS (7 tests)

- [ ] **Step 5: Run the full test suite**

Run: `.venv/Scripts/python.exe -m pytest -v`
Expected: all PASS. (`routes_connectors.py` will fail to import at this point if pytest collects
it transitively through `app.main` — if so, that's Task 5's job; confirm the only failure is import
errors coming from `routes_connectors.py`'s reference to the old `link_gitlab_repos` signature, not
anything in this task's files.)

- [ ] **Step 6: Commit**

```bash
git add portal/services/ingestion-api/app/api/routes_gitlab.py portal/services/ingestion-api/tests/conftest.py portal/services/ingestion-api/tests/api/__init__.py portal/services/ingestion-api/tests/api/test_routes_gitlab.py
git commit -m "feat(ingestion-api): real GitLab search/branches/test-connection endpoints backed by Vault tokens"
```

---

### Task 5: `routes_connectors.py` — adapt repo-linking endpoint to the new payload shape

**Files:**
- Modify: `portal/services/ingestion-api/app/api/routes_connectors.py`
- Test: `portal/services/ingestion-api/tests/api/test_routes_connectors_repos.py` (new)

**Interfaces:**
- Consumes: `link_gitlab_repos(connector_id, selections)` (Task 3),
  `LinkGitlabReposRequest`/`GitLabRepoSelection` (Task 3).
- Produces: `POST /api/v1/connectors/{connector_id}/repos` now expects body
  `{"repos": [{"repo_id": str, "repo_name": str, "grupo": str, "rama": str}, ...]}` — this is the
  exact shape Task 6's BFF proxy forwards and Task 7's frontend sends.

- [ ] **Step 1: Write the failing test**

Create `portal/services/ingestion-api/tests/api/test_routes_connectors_repos.py`:

```python
from app.db.session import _connectors
from app.models.schemas import Connector, ConnectorKind


def _seed_gitlab_connector() -> None:
    _connectors["gl-link-test"] = Connector(
        id="gl-link-test",
        kind=ConnectorKind.gitlab,
        name="GitLab Link Test",
        base_uri="https://gitlab.test",
        vault_secret_ref="secrets/kb/gitlab-test",
    )


def test_post_connector_repos_with_selections_payload(admin_client) -> None:
    _seed_gitlab_connector()
    response = admin_client.post(
        "/api/v1/connectors/gl-link-test/repos",
        json={"repos": [{"repo_id": "4892", "repo_name": "telemetry/gps-core", "grupo": "telemetry", "rama": "main"}]},
    )
    assert response.status_code == 201
    body = response.json()
    assert len(body) == 1
    assert body[0]["repo"] == "telemetry/gps-core"
    assert body[0]["rama"] == "main"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/Scripts/python.exe -m pytest tests/api/test_routes_connectors_repos.py -v`
Expected: FAIL — either a 422 (old handler still expects `repo_ids`/`branch_by_id`) or a
`TypeError` from the old `link_gitlab_repos` call signature mismatch (Task 3 already changed the
function signature; this route hasn't been updated to match yet).

- [ ] **Step 3: Update the route handler**

In `portal/services/ingestion-api/app/api/routes_connectors.py`, change line 91 from:

```python
    return link_gitlab_repos(connector_id, body.repo_ids, body.branch_by_id)
```

to:

```python
    return link_gitlab_repos(connector_id, body.repos)
```

No other change is needed in this file — `LinkGitlabReposRequest` (imported on line 21) already
has the new `repos: list[GitLabRepoSelection]` shape from Task 3.

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/Scripts/python.exe -m pytest tests/api/test_routes_connectors_repos.py -v`
Expected: PASS

- [ ] **Step 5: Run the full backend test suite**

Run: `.venv/Scripts/python.exe -m pytest -v`
Expected: all tests across `tests/core/`, `tests/db/`, `tests/api/` PASS.

- [ ] **Step 6: Commit**

```bash
git add portal/services/ingestion-api/app/api/routes_connectors.py portal/services/ingestion-api/tests/api/test_routes_connectors_repos.py
git commit -m "fix(ingestion-api): adapt POST /connectors/{id}/repos to the new repo-selection payload shape"
```

---

### Task 6: BFF proxy routes for search, branches, and test-connection

**Files:**
- Delete: `portal/bff/src/app/api/ingesta/gitlab-catalog/route.ts`
- Create: `portal/bff/src/app/api/ingesta/gitlab/[id]/search/route.ts`
- Create: `portal/bff/src/app/api/ingesta/gitlab/[id]/branches/[repoId]/route.ts`
- Create: `portal/bff/src/app/api/ingesta/gitlab/test-connection/route.ts`

**Interfaces:**
- Consumes: `getSession()` from `portal/bff/src/lib/session.ts` (existing, unchanged), the
  ingestion-api endpoints from Task 4 (`GET .../gitlab/connectors/{id}/search?q=`,
  `GET .../gitlab/connectors/{id}/repos/{repoId}/branches`, `POST .../gitlab/test-connection`).
- Produces (used by Task 7): three BFF-facing routes at
  `/api/ingesta/gitlab/{id}/search?q=`, `/api/ingesta/gitlab/{id}/branches/{repoId}`,
  `/api/ingesta/gitlab/test-connection`.

This task has no backend logic to unit test (thin proxies, same pattern as every other
`portal/bff/src/app/api/ingesta/*` route) — verification is manual, via the running dev stack, per
Step 4.

- [ ] **Step 1: Remove the obsolete catalog proxy route**

Delete `portal/bff/src/app/api/ingesta/gitlab-catalog/route.ts` (its backing ingestion-api endpoint
no longer exists after Task 4).

- [ ] **Step 2: Create the search proxy**

Create `portal/bff/src/app/api/ingesta/gitlab/[id]/search/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";

const upstream = process.env.INGESTION_API_URL ?? "http://localhost:8001";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  const q = request.nextUrl.searchParams.get("q") ?? "";
  const response = await fetch(`${upstream}/api/v1/gitlab/connectors/${id}/search?q=${encodeURIComponent(q)}`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  return NextResponse.json(body, { status: response.status });
}
```

- [ ] **Step 3: Create the branches proxy**

Create `portal/bff/src/app/api/ingesta/gitlab/[id]/branches/[repoId]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";

const upstream = process.env.INGESTION_API_URL ?? "http://localhost:8001";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; repoId: string }> },
): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id, repoId } = await params;
  const response = await fetch(`${upstream}/api/v1/gitlab/connectors/${id}/repos/${repoId}/branches`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  return NextResponse.json(body, { status: response.status });
}
```

- [ ] **Step 4: Create the test-connection proxy**

Create `portal/bff/src/app/api/ingesta/gitlab/test-connection/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";

const upstream = process.env.INGESTION_API_URL ?? "http://localhost:8001";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const payload = await request.json();
  const response = await fetch(`${upstream}/api/v1/gitlab/test-connection`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (response.status === 204) return new NextResponse(null, { status: 204 });
  const body = await response.json().catch(() => ({}));
  return NextResponse.json(body, { status: response.status });
}
```

- [ ] **Step 5: Verify the BFF still builds**

Run (from `portal/bff/`): `npx tsc --noEmit`
Expected: no new type errors (route handlers have no compile-time dependency on files this task
didn't touch).

- [ ] **Step 6: Commit**

```bash
git add portal/bff/src/app/api/ingesta/gitlab
git rm portal/bff/src/app/api/ingesta/gitlab-catalog/route.ts
git commit -m "feat(bff): proxy GitLab search/branches/test-connection to ingestion-api, drop static catalog proxy"
```

---

### Task 7: `ingesta-api.service.ts` — Angular API client updates

**Files:**
- Modify: `portal/micro-ui-ingesta/src/app/ingesta-api.service.ts`

**Interfaces:**
- Consumes: the three BFF routes from Task 6.
- Produces (used by Tasks 8 and 9):
  ```typescript
  export interface GitLabSearchResult { id: string; nombre: string; grupo: string; }
  export interface GitLabBranches { ramas_disponibles: string[]; rama_default: string; }
  export interface GitLabRepoSelection { repo_id: string; repo_name: string; grupo: string; rama: string; }

  searchGitlabRepos(connectorId: string, query: string): Promise<GitLabSearchResult[]>
  getGitlabBranches(connectorId: string, repoId: string): Promise<GitLabBranches | null>
  linkGitlabRepos(connectorId: string, selections: GitLabRepoSelection[]): Promise<GitLabRepoLink[]>
  testGitlabConnection(baseUri: string, vaultSecretRef: string): Promise<{ ok: boolean; error?: string }>
  ```

No dedicated test harness exists for `micro-ui-ingesta` (consistent with the rest of this feature
area, per the spec's Testing section) — this task is verified as part of Task 8's manual check.

- [ ] **Step 1: Remove the old catalog interface/method and add the new interfaces**

In `portal/micro-ui-ingesta/src/app/ingesta-api.service.ts`, replace the `GitLabCatalogEntry`
interface (lines 36-42) with:

```typescript
export interface GitLabSearchResult {
  id: string;
  nombre: string;
  grupo: string;
}

export interface GitLabBranches {
  ramas_disponibles: string[];
  rama_default: string;
}

export interface GitLabRepoSelection {
  repo_id: string;
  repo_name: string;
  grupo: string;
  rama: string;
}
```

- [ ] **Step 2: Replace `listGitlabCatalog` and `linkGitlabRepos`, add the new methods**

Replace the `listGitlabCatalog` method (lines 125-129) and the `linkGitlabRepos` method (lines
137-146) with:

```typescript
  async searchGitlabRepos(connectorId: string, query: string): Promise<GitLabSearchResult[]> {
    const response = await fetch(
      `${BFF_BASE_URL}/api/ingesta/gitlab/${connectorId}/search?q=${encodeURIComponent(query)}`,
      { credentials: "include" },
    );
    if (!response.ok) return [];
    return (await response.json()) as GitLabSearchResult[];
  }

  async getGitlabBranches(connectorId: string, repoId: string): Promise<GitLabBranches | null> {
    const response = await fetch(`${BFF_BASE_URL}/api/ingesta/gitlab/${connectorId}/branches/${repoId}`, {
      credentials: "include",
    });
    if (!response.ok) return null;
    return (await response.json()) as GitLabBranches;
  }

  async linkGitlabRepos(connectorId: string, selections: GitLabRepoSelection[]): Promise<GitLabRepoLink[]> {
    const response = await fetch(`${BFF_BASE_URL}/api/ingesta/connectors/${connectorId}/repos`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repos: selections }),
    });
    if (!response.ok) return [];
    return (await response.json()) as GitLabRepoLink[];
  }

  async testGitlabConnection(baseUri: string, vaultSecretRef: string): Promise<{ ok: boolean; error?: string }> {
    const response = await fetch(`${BFF_BASE_URL}/api/ingesta/gitlab/test-connection`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base_uri: baseUri, vault_secret_ref: vaultSecretRef }),
    });
    if (response.ok) return { ok: true };
    const body: unknown = await response.json().catch(() => null);
    const detail =
      body && typeof body === "object" && "detail" in body && typeof body.detail === "string"
        ? body.detail
        : `HTTP ${response.status}`;
    return { ok: false, error: detail };
  }
```

- [ ] **Step 3: Verify the Angular workspace still compiles**

Run (from `portal/micro-ui-ingesta/`): `npx tsc --noEmit -p tsconfig.json`
Expected: errors ONLY in `administrar-repositorios.component.ts` and `conectores.component.ts`
(both still reference the old `listGitlabCatalog`/old `linkGitlabRepos` signature/`GitLabCatalogEntry`
— fixed in Tasks 8 and 9). No errors in `ingesta-api.service.ts` itself.

- [ ] **Step 4: Commit**

```bash
git add portal/micro-ui-ingesta/src/app/ingesta-api.service.ts
git commit -m "feat(micro-ui-ingesta): replace static GitLab catalog client with search/branches/test-connection calls"
```

---

### Task 8: `administrar-repositorios.component.ts` — search-on-demand UI rewrite

**Files:**
- Modify: `portal/micro-ui-ingesta/src/app/pages/administrar-repositorios/administrar-repositorios.component.ts`

**Interfaces:**
- Consumes: `searchGitlabRepos`, `getGitlabBranches`, `linkGitlabRepos`,
  `GitLabSearchResult`, `GitLabBranches`, `GitLabRepoSelection` (Task 7).
- Produces: nothing consumed by later tasks (leaf component).

- [ ] **Step 1: Replace the full component file**

Replace the full contents of
`portal/micro-ui-ingesta/src/app/pages/administrar-repositorios/administrar-repositorios.component.ts`:

```typescript
import { Component, OnInit, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, Router } from "@angular/router";
import { GitLabBranches, GitLabRepoLink, GitLabRepoSelection, GitLabSearchResult, IngestaApiService } from "../../ingesta-api.service";

interface SearchRow {
  entry: GitLabSearchResult;
  branches: GitLabBranches | null;
  branchesLoading: boolean;
  branchesError: string | null;
  selectedBranch: string;
}

// Pantalla "Administrar repositorios GitLab" del diseño Claude Design: búsqueda en vivo contra
// la API real de GitLab (por nombre o ID), carga de ramas al seleccionar, y tabla de vinculados.
@Component({
  selector: "km-administrar-repositorios",
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div style="padding:24px">
      <button type="button" class="btn btn-ghost" style="padding-inline:0;margin-bottom:12px" (click)="volver()">
        ← Volver a Conectores y Fuentes
      </button>

      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap">
        <input
          class="input"
          style="max-width:320px"
          placeholder="Buscar por nombre o ID de repositorio…"
          [(ngModel)]="searchText"
          name="searchText"
          (ngModelChange)="onSearchTextChange($event)"
        />
        <button type="button" class="btn btn-primary" [disabled]="selectedRows().length === 0 || linking()" (click)="addSelected()">
          {{ linking() ? "Añadiendo…" : "Añadir seleccionados (" + selectedRows().length + ")" }}
        </button>
      </div>

      <div class="card" style="padding:12px;margin-bottom:14px;background:var(--color-danger-100,#fee2e2)" *ngIf="errorBanner()">
        <div style="font-size:13px;color:var(--color-danger-800,#991b1b)">{{ errorBanner() }}</div>
      </div>

      <table class="table">
        <thead>
          <tr>
            <th style="width:32px"></th>
            <th>ID</th>
            <th>Nombre</th>
            <th>Grupo</th>
            <th>Rama</th>
          </tr>
        </thead>
        <tbody>
          <tr *ngFor="let row of rows()">
            <td>
              <input
                type="checkbox"
                style="accent-color:var(--color-accent);width:16px;height:16px"
                [checked]="isSelected(row.entry.id)"
                [disabled]="isLinked(row.entry.id)"
                (change)="toggleSelected(row)"
              />
            </td>
            <td style="font-family:ui-monospace,Menlo,monospace;font-size:12px">{{ row.entry.id }}</td>
            <td>{{ row.entry.nombre }}</td>
            <td class="text-muted">{{ row.entry.grupo }}</td>
            <td>
              <span class="text-muted" style="font-size:12px" *ngIf="row.branchesLoading">Cargando ramas…</span>
              <span class="text-muted" style="font-size:12px" *ngIf="row.branchesError">{{ row.branchesError }}</span>
              <select
                class="input"
                style="height:32px;padding:0 8px"
                *ngIf="row.branches && !row.branchesLoading"
                [disabled]="isLinked(row.entry.id)"
                (change)="setBranch(row, $event)"
              >
                <option *ngFor="let rama of row.branches.ramas_disponibles" [value]="rama" [selected]="rama === row.selectedBranch">{{ rama }}</option>
              </select>
            </td>
          </tr>
        </tbody>
      </table>
      <div class="text-muted" *ngIf="searchText.trim().length === 0" style="margin-top:16px">
        Escribe un nombre o ID de repositorio para buscar en GitLab.
      </div>
      <div class="text-muted" *ngIf="searchText.trim().length > 0 && !searching() && rows().length === 0" style="margin-top:16px">
        Ningún repositorio coincide con la búsqueda.
      </div>

      <h4 style="margin-top:28px">Repositorios ya vinculados</h4>
      <table class="table" style="margin-top:10px">
        <thead>
          <tr><th>Repositorio</th><th>Rama</th><th>Ruta</th><th>Estado</th></tr>
        </thead>
        <tbody>
          <tr *ngFor="let link of linkedRepos()">
            <td>{{ link.repo }}</td>
            <td><span class="tag tag-outline">{{ link.rama }}</span></td>
            <td style="font-size:13px">{{ link.ruta }}</td>
            <td><span class="tag tag-accent">{{ link.estado }}</span></td>
          </tr>
          <tr *ngIf="linkedRepos().length === 0">
            <td colspan="4" class="text-muted">Sin repositorios vinculados todavía.</td>
          </tr>
        </tbody>
      </table>
    </div>
  `,
})
export class AdministrarRepositoriosComponent implements OnInit {
  private readonly api = inject(IngestaApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private connectorId = "";
  protected searchText = "";
  protected readonly rows = signal<SearchRow[]>([]);
  protected readonly linkedRepos = signal<GitLabRepoLink[]>([]);
  protected readonly linking = signal(false);
  protected readonly searching = signal(false);
  protected readonly errorBanner = signal<string | null>(null);

  private searchDebounce: ReturnType<typeof setTimeout> | null = null;

  async ngOnInit(): Promise<void> {
    this.connectorId = this.route.snapshot.paramMap.get("id") ?? "";
    this.linkedRepos.set(await this.api.listConnectorRepos(this.connectorId));
  }

  protected onSearchTextChange(value: string): void {
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
    const text = value.trim();
    if (!text) {
      this.rows.set([]);
      return;
    }
    this.searchDebounce = setTimeout(() => void this.runSearch(text), 300);
  }

  private async runSearch(text: string): Promise<void> {
    this.searching.set(true);
    this.errorBanner.set(null);
    try {
      const results = await this.api.searchGitlabRepos(this.connectorId, text);
      this.rows.set(
        results.map((entry) => ({ entry, branches: null, branchesLoading: false, branchesError: null, selectedBranch: "" })),
      );
    } catch {
      this.errorBanner.set("No se pudo conectar a GitLab: error de red.");
      this.rows.set([]);
    } finally {
      this.searching.set(false);
    }
  }

  protected isLinked(repoId: string): boolean {
    return this.linkedRepos().some((link) => link.repo_id === repoId);
  }

  protected isSelected(repoId: string): boolean {
    return this.rows().some((row) => row.entry.id === repoId && row.branches !== null && row.selectedBranch !== "" && this.selectedIds.has(repoId));
  }

  private readonly selectedIds = new Set<string>();

  protected async toggleSelected(row: SearchRow): Promise<void> {
    if (this.selectedIds.has(row.entry.id)) {
      this.selectedIds.delete(row.entry.id);
      this.rows.update((current) => current.map((r) => (r.entry.id === row.entry.id ? { ...r, branches: null, selectedBranch: "" } : r)));
      return;
    }

    this.selectedIds.add(row.entry.id);
    this.rows.update((current) => current.map((r) => (r.entry.id === row.entry.id ? { ...r, branchesLoading: true, branchesError: null } : r)));

    const branches = await this.api.getGitlabBranches(this.connectorId, row.entry.id);
    if (branches === null) {
      this.selectedIds.delete(row.entry.id);
      this.rows.update((current) =>
        current.map((r) =>
          r.entry.id === row.entry.id
            ? { ...r, branchesLoading: false, branchesError: "No se pudieron cargar las ramas." }
            : r,
        ),
      );
      return;
    }

    this.rows.update((current) =>
      current.map((r) =>
        r.entry.id === row.entry.id
          ? { ...r, branches, branchesLoading: false, branchesError: null, selectedBranch: branches.rama_default }
          : r,
      ),
    );
  }

  protected setBranch(row: SearchRow, event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.rows.update((current) => current.map((r) => (r.entry.id === row.entry.id ? { ...r, selectedBranch: value } : r)));
  }

  protected selectedRows(): SearchRow[] {
    return this.rows().filter((row) => this.selectedIds.has(row.entry.id) && row.branches !== null);
  }

  protected async addSelected(): Promise<void> {
    const selections: GitLabRepoSelection[] = this.selectedRows().map((row) => ({
      repo_id: row.entry.id,
      repo_name: row.entry.nombre,
      grupo: row.entry.grupo,
      rama: row.selectedBranch,
    }));
    if (selections.length === 0) return;

    this.linking.set(true);
    try {
      await this.api.linkGitlabRepos(this.connectorId, selections);
      this.selectedIds.clear();
      this.rows.set([]);
      this.searchText = "";
      this.linkedRepos.set(await this.api.listConnectorRepos(this.connectorId));
    } finally {
      this.linking.set(false);
    }
  }

  protected volver(): void {
    void this.router.navigate(["/ingesta/conectores"]);
  }
}
```

- [ ] **Step 2: Manual verification**

With the full dev stack running (shell, micro-ui-ingesta, BFF, ingestion-api — per this session's
established workflow), navigate to a GitLab connector's "Administrar repositorios" screen:
1. Confirm the table starts empty with the "Escribe un nombre o ID…" hint.
2. Type a partial repo name — after ~300ms, confirm a network request to
   `GET /api/ingesta/gitlab/{id}/search?q=...` fires and results render.
3. Type a numeric project ID — confirm the request goes to the same endpoint (the numeric/text
   dispatch happens server-side) and returns at most one result.
4. Check a result's checkbox — confirm "Cargando ramas…" appears briefly, then a branch `<select>`
   populated with real branches, defaulted to the repo's default branch.
5. Click "Añadir seleccionados" — confirm it appears in "Repositorios ya vinculados" and the
   search/selection state clears.
6. With an intentionally invalid Vault secret ref on the connector (or an unreachable GitLab URL),
   repeat a search and confirm the red error banner appears with a clear message.

- [ ] **Step 3: Commit**

```bash
git add portal/micro-ui-ingesta/src/app/pages/administrar-repositorios/administrar-repositorios.component.ts
git commit -m "feat(micro-ui-ingesta): search-on-demand GitLab repo management with lazy branch loading"
```

---

### Task 9: `conectores.component.ts` — real "Verificar conectividad" for GitLab

**Files:**
- Modify: `portal/micro-ui-ingesta/src/app/pages/conectores/conectores.component.ts`

**Interfaces:**
- Consumes: `testGitlabConnection(baseUri, vaultSecretRef)` (Task 7).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Replace the simulated `testConnection` method**

In `portal/micro-ui-ingesta/src/app/pages/conectores/conectores.component.ts`, replace the
`testConnection` method (lines 209-218):

```typescript
  protected testConnection(): void {
    this.testResult.set({ message: "Verificando conectividad...", bg: "var(--color-neutral-100)", color: "var(--color-text)" });
    setTimeout(() => {
      this.testResult.set({
        message: "✓ Conexión exitosa. Credencial validada en Vault.",
        bg: "var(--color-accent-100)",
        color: "var(--color-accent-800)",
      });
    }, 800);
  }
```

with:

```typescript
  protected async testConnection(): Promise<void> {
    this.testResult.set({ message: "Verificando conectividad...", bg: "var(--color-neutral-100)", color: "var(--color-text)" });

    if (this.form.kind !== "gitlab") {
      this.testResult.set({
        message: "Verificación no disponible para este tipo de conector todavía.",
        bg: "var(--color-neutral-100)",
        color: "var(--color-text)",
      });
      return;
    }

    const result = await this.api.testGitlabConnection(this.form.base_uri, this.form.vault_secret_ref);
    if (result.ok) {
      this.testResult.set({
        message: "✓ Conexión exitosa. Credencial validada en Vault.",
        bg: "var(--color-accent-100)",
        color: "var(--color-accent-800)",
      });
    } else {
      this.testResult.set({
        message: `✗ ${result.error ?? "No se pudo conectar."}`,
        bg: "var(--color-danger-100,#fee2e2)",
        color: "var(--color-danger-800,#991b1b)",
      });
    }
  }
```

The template's button (line 166) already calls `(click)="testConnection()"` — no template change
needed since Angular's `(click)` binding handles async handlers transparently.

- [ ] **Step 2: Verify the Angular workspace compiles cleanly**

Run (from `portal/micro-ui-ingesta/`): `npx tsc --noEmit -p tsconfig.json`
Expected: no errors anywhere in `src/app/` — this is the last task touching frontend files that
consume `ingesta-api.service.ts`, so the codebase should be fully consistent now.

- [ ] **Step 3: Manual verification**

With the dev stack running, open "Nuevo conector", select type "GitLab", fill in a real
`base_uri` and `vault_secret_ref` (pointing at a real or intentionally-invalid Vault secret), and
click "Verificar conectividad":
1. Confirm the pending state shows immediately.
2. With a valid token: confirm the green success message appears, sourced from a real
   `POST /api/ingesta/gitlab/test-connection` call (check the Network tab).
3. With an invalid/missing token: confirm a red error message appears with the backend's actual
   error detail (e.g. "No se pudo conectar a GitLab: 401 Unauthorized"), not a generic message.

- [ ] **Step 4: Commit**

```bash
git add portal/micro-ui-ingesta/src/app/pages/conectores/conectores.component.ts
git commit -m "feat(micro-ui-ingesta): wire Verificar conectividad to the real GitLab test-connection call"
```

---

## Final Verification (after all tasks)

- [ ] Run the full ingestion-api test suite once more from a clean state:
  `.venv/Scripts/python.exe -m pytest -v` (from `portal/services/ingestion-api/`) — all tests
  pass.
- [ ] Run `npx tsc --noEmit -p tsconfig.json` from both `portal/micro-ui-ingesta/` and
  `portal/bff/` — no errors.
- [ ] With the full stack running, walk through the end-to-end flow once more: search a real repo
  by name, search the same repo by its numeric ID, select it, confirm branches load, link it,
  confirm it appears in "Conectores y Fuentes"' operational detail table, and confirm "Verificar
  conectividad" reflects a real GitLab call.
