# Gestión completa de Conectores y Fuentes — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar la sección "Detalle operacional / GitLab Enterprise Server", el botón "Configurar" (editar conector), las acciones primarias por tipo (Administrar repositorios / Seleccionar carpetas / Esquemas mapeados) y el panel lateral rediseñado de "Nuevo conector" en el portal de ingesta.

**Architecture:** Extiende el patrón ya establecido (FastAPI in-memory store → BFF proxy con bearer forwarding → Angular standalone components) con nuevos modelos/endpoints por sub-recurso de conector (repos, carpetas, esquemas) y un CRUD de edición de conector.

**Tech Stack:** FastAPI + Pydantic (backend), Next.js App Router route handlers (BFF), Angular 18 standalone components + signals (frontend). Sin frameworks de test en el repo — verificación manual vía `curl` y navegador, consistente con el resto del scaffold.

**Spec:** `docs/superpowers/specs/2026-09-06-conectores-gestion-completa-design.md`

## Global Constraints

- Toda escritura (POST/PATCH) requiere rol `km-admin`; lectura requiere `km-admin` o `km-auditor` (mismo patrón que `routes_connectors.py` ya implementado).
- Ningún endpoint acepta ni devuelve secretos reales — solo referencias Vault (`vault_secret_ref`), igual que el resto del scaffold.
- El BFF nunca expone el `access_token` al browser; todo proxy usa `getSession()` + `Authorization: Bearer` server-side, igual que las rutas existentes.
- Frontend: manejo de errores con try/catch/finally en cualquier acción async que cambie un estado "cargando" (evita el bug de "Guardando…" colgado ya corregido en el diálogo de creación).
- Tipos creables en "Nuevo conector": solo `gitlab`, `gdrive`, `db` (no `upload`/`schema`).

---

## Task 1: Modelos y stores in-memory nuevos (backend)

**Files:**
- Modify: `portal/services/ingestion-api/app/models/schemas.py`
- Modify: `portal/services/ingestion-api/app/db/session.py`

**Interfaces:**
- Produces: clases Pydantic `GitLabRepoLink`, `GitLabCatalogEntry`, `LinkGitlabReposRequest`, `DriveFolderLink`, `DriveCatalogEntry`, `LinkDriveFoldersRequest`, `SchemaTable`, `UpdateConnectorRequest`; funciones `list_gitlab_catalog()`, `list_repo_links(connector_id)`, `link_gitlab_repos(connector_id, repo_ids, branch_by_id)`, `list_gdrive_catalog()`, `list_folder_links(connector_id)`, `link_gdrive_folders(connector_id, folder_ids)`, `list_schema_tables(connector_id)`, `update_connector(connector_id, **fields)`.

- [ ] **Step 1: Agregar los modelos Pydantic a `schemas.py`**

Añadir después de `Connector` (y agregar `descripcion: str = ""` a `Connector` y `CreateConnectorRequest`):

```python
class Connector(BaseModel):
    id: str
    kind: ConnectorKind
    name: str
    base_uri: str
    vault_secret_ref: str = Field(description="Referencia Vault, nunca el secreto en si (secrets/kb/...)")
    descripcion: str = ""
    active: bool = True
    healthy: bool = True


class CreateConnectorRequest(BaseModel):
    kind: ConnectorKind
    name: str
    base_uri: str
    vault_secret_ref: str = Field(description="Referencia Vault, nunca el secreto en si (secrets/kb/...)")
    descripcion: str = ""


class UpdateConnectorRequest(BaseModel):
    name: str | None = None
    base_uri: str | None = None
    vault_secret_ref: str | None = None
    active: bool | None = None


class GitLabCatalogEntry(BaseModel):
    id: str
    nombre: str
    grupo: str
    rama_default: str
    ramas_disponibles: list[str]


class GitLabRepoLink(BaseModel):
    id: str
    connector_id: str
    repo: str
    repo_id: str
    rama: str
    ruta: str = "/"
    auto_sync: bool = True
    estado: str = "Sincronizado"


class LinkGitlabReposRequest(BaseModel):
    repo_ids: list[str]
    branch_by_id: dict[str, str] = Field(default_factory=dict)


class DriveCatalogEntry(BaseModel):
    id: str
    path: str
    tipo: str


class DriveFolderLink(BaseModel):
    id: str
    connector_id: str
    path: str
    tipo: str


class LinkDriveFoldersRequest(BaseModel):
    folder_ids: list[str]


class SchemaTable(BaseModel):
    id: str
    connector_id: str
    tabla: str
    columnas: int
    motor: str
```

- [ ] **Step 2: Agregar los stores y funciones a `session.py`**

Añadir al final del archivo (después de `create_connector`):

```python
def update_connector(connector_id: str, **fields: object) -> Connector | None:
    existing = _connectors.get(connector_id)
    if existing is None:
        return None
    updated = existing.model_copy(update={k: v for k, v in fields.items() if v is not None})
    _connectors[connector_id] = updated
    return updated


_gitlab_catalog: list[GitLabCatalogEntry] = [
    GitLabCatalogEntry(id="4892", nombre="telemetry/gps-core", grupo="telemetry", rama_default="main", ramas_disponibles=["main", "develop"]),
    GitLabCatalogEntry(id="5012", nombre="core-api/gateway", grupo="core-api", rama_default="master", ramas_disponibles=["master", "develop"]),
    GitLabCatalogEntry(id="6120", nombre="dispatch/routing-engine", grupo="dispatch", rama_default="release-2026", ramas_disponibles=["release-2026", "main"]),
    GitLabCatalogEntry(id="3204", nombre="frontend/client-portal", grupo="frontend", rama_default="main", ramas_disponibles=["main", "develop"]),
    GitLabCatalogEntry(id="7031", nombre="telemetry/fleet-events", grupo="telemetry", rama_default="main", ramas_disponibles=["main"]),
    GitLabCatalogEntry(id="7145", nombre="billing/invoicing-service", grupo="billing", rama_default="main", ramas_disponibles=["main", "develop"]),
]

_repo_links: dict[str, GitLabRepoLink] = {}


def list_gitlab_catalog() -> list[GitLabCatalogEntry]:
    return list(_gitlab_catalog)


def list_repo_links(connector_id: str) -> list[GitLabRepoLink]:
    return [link for link in _repo_links.values() if link.connector_id == connector_id]


def link_gitlab_repos(connector_id: str, repo_ids: list[str], branch_by_id: dict[str, str]) -> list[GitLabRepoLink]:
    catalog_by_id = {entry.id: entry for entry in _gitlab_catalog}
    already_linked = {link.repo_id for link in _repo_links.values() if link.connector_id == connector_id}
    created: list[GitLabRepoLink] = []
    for repo_id in repo_ids:
        entry = catalog_by_id.get(repo_id)
        if entry is None or repo_id in already_linked:
            continue
        link_id = f"rl-{connector_id}-{repo_id}"
        link = GitLabRepoLink(
            id=link_id,
            connector_id=connector_id,
            repo=entry.nombre,
            repo_id=repo_id,
            rama=branch_by_id.get(repo_id, entry.rama_default),
        )
        _repo_links[link_id] = link
        created.append(link)
    return created


_gdrive_catalog: list[DriveCatalogEntry] = [
    DriveCatalogEntry(id="d1", path="KM/Políticas", tipo="Carpeta compartida"),
    DriveCatalogEntry(id="d2", path="KM/Procesos", tipo="Carpeta compartida"),
    DriveCatalogEntry(id="d3", path="Legal/Contratos", tipo="Restringida"),
    DriveCatalogEntry(id="d4", path="KM/Manuales-Tecnicos", tipo="Carpeta compartida"),
    DriveCatalogEntry(id="d5", path="Finanzas/Arquitectura", tipo="Restringida"),
]

_folder_links: dict[str, DriveFolderLink] = {}


def list_gdrive_catalog() -> list[DriveCatalogEntry]:
    return list(_gdrive_catalog)


def list_folder_links(connector_id: str) -> list[DriveFolderLink]:
    return [link for link in _folder_links.values() if link.connector_id == connector_id]


def link_gdrive_folders(connector_id: str, folder_ids: list[str]) -> list[DriveFolderLink]:
    catalog_by_id = {entry.id: entry for entry in _gdrive_catalog}
    already_linked = {link.id.rsplit("-", 1)[-1] for link in _folder_links.values() if link.connector_id == connector_id}
    created: list[DriveFolderLink] = []
    for folder_id in folder_ids:
        entry = catalog_by_id.get(folder_id)
        if entry is None or folder_id in already_linked:
            continue
        link_id = f"fl-{connector_id}-{folder_id}"
        link = DriveFolderLink(id=link_id, connector_id=connector_id, path=entry.path, tipo=entry.tipo)
        _folder_links[link_id] = link
        created.append(link)
    return created


_schema_tables: list[SchemaTable] = [
    SchemaTable(id="st1", connector_id="", tabla="clientes", columnas=18, motor="MySQL"),
    SchemaTable(id="st2", connector_id="", tabla="facturas", columnas=24, motor="MySQL"),
    SchemaTable(id="st3", connector_id="", tabla="vehiculos", columnas=15, motor="PostgreSQL"),
    SchemaTable(id="st4", connector_id="", tabla="rutas", columnas=9, motor="PostgreSQL"),
]


def list_schema_tables(connector_id: str) -> list[SchemaTable]:
    return [table.model_copy(update={"connector_id": connector_id}) for table in _schema_tables]
```

Nota: `list_schema_tables` devuelve el mismo catálogo de ejemplo para cualquier `connector_id`
de tipo `schema` (no hay una BD real detrás) — es intencional, coherente con el resto del scaffold.

- [ ] **Step 3: Verificar que el módulo importa sin errores**

Run: `cd portal/services/ingestion-api && ./.venv/Scripts/python.exe -c "import app.db.session"`
Expected: sin salida (sin excepción).

- [ ] **Step 4: Commit**

```bash
git add portal/services/ingestion-api/app/models/schemas.py portal/services/ingestion-api/app/db/session.py
git commit -m "feat(ingestion-api): add repo/folder/schema link models and stores"
```

---

## Task 2: Endpoints backend — repos GitLab, carpetas Drive, esquemas, editar conector

**Files:**
- Modify: `portal/services/ingestion-api/app/api/routes_connectors.py`
- Create: `portal/services/ingestion-api/app/api/routes_gitlab.py`
- Create: `portal/services/ingestion-api/app/api/routes_gdrive.py`
- Modify: `portal/services/ingestion-api/app/main.py`

**Interfaces:**
- Consumes: funciones de `app/db/session.py` de Task 1.
- Produces: rutas `GET/PATCH /api/v1/connectors/{id}` (nueva variante con id), `GET/POST /api/v1/connectors/{id}/repos`, `GET/POST /api/v1/connectors/{id}/folders`, `GET /api/v1/connectors/{id}/schemas`, `GET /api/v1/gitlab/catalog`, `GET /api/v1/gdrive/catalog`.

- [ ] **Step 1: Agregar PATCH y sub-recursos a `routes_connectors.py`**

Reemplazar el contenido completo del archivo:

```python
from fastapi import APIRouter, Depends, HTTPException, status

from app.core.security import Principal, require_role
from app.db.session import (
    create_connector,
    get_connector,
    link_gitlab_repos,
    link_gdrive_folders,
    list_connectors,
    list_folder_links,
    list_repo_links,
    list_schema_tables,
    update_connector,
)
from app.models.schemas import (
    Connector,
    CreateConnectorRequest,
    DriveFolderLink,
    GitLabRepoLink,
    LinkDriveFoldersRequest,
    LinkGitlabReposRequest,
    SchemaTable,
    UpdateConnectorRequest,
)

router = APIRouter(prefix="/connectors", tags=["connectors"])

_READ_ROLES = ("km-admin", "km-auditor")
_WRITE_ROLES = ("km-admin",)


def _require_connector(connector_id: str) -> Connector:
    connector = get_connector(connector_id)
    if connector is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conector no encontrado")
    return connector


@router.get("", response_model=list[Connector])
async def get_connectors(_principal: Principal = Depends(require_role(*_READ_ROLES))) -> list[Connector]:
    return list_connectors()


@router.post("", response_model=Connector, status_code=status.HTTP_201_CREATED)
async def post_connector(
    body: CreateConnectorRequest,
    _principal: Principal = Depends(require_role(*_WRITE_ROLES)),
) -> Connector:
    return create_connector(
        kind=body.kind,
        name=body.name,
        base_uri=body.base_uri,
        vault_secret_ref=body.vault_secret_ref,
    )


@router.patch("/{connector_id}", response_model=Connector)
async def patch_connector(
    connector_id: str,
    body: UpdateConnectorRequest,
    _principal: Principal = Depends(require_role(*_WRITE_ROLES)),
) -> Connector:
    _require_connector(connector_id)
    updated = update_connector(
        connector_id,
        name=body.name,
        base_uri=body.base_uri,
        vault_secret_ref=body.vault_secret_ref,
        active=body.active,
    )
    assert updated is not None
    return updated


@router.get("/{connector_id}/repos", response_model=list[GitLabRepoLink])
async def get_connector_repos(
    connector_id: str,
    _principal: Principal = Depends(require_role(*_READ_ROLES)),
) -> list[GitLabRepoLink]:
    _require_connector(connector_id)
    return list_repo_links(connector_id)


@router.post("/{connector_id}/repos", response_model=list[GitLabRepoLink], status_code=status.HTTP_201_CREATED)
async def post_connector_repos(
    connector_id: str,
    body: LinkGitlabReposRequest,
    _principal: Principal = Depends(require_role(*_WRITE_ROLES)),
) -> list[GitLabRepoLink]:
    _require_connector(connector_id)
    return link_gitlab_repos(connector_id, body.repo_ids, body.branch_by_id)


@router.get("/{connector_id}/folders", response_model=list[DriveFolderLink])
async def get_connector_folders(
    connector_id: str,
    _principal: Principal = Depends(require_role(*_READ_ROLES)),
) -> list[DriveFolderLink]:
    _require_connector(connector_id)
    return list_folder_links(connector_id)


@router.post("/{connector_id}/folders", response_model=list[DriveFolderLink], status_code=status.HTTP_201_CREATED)
async def post_connector_folders(
    connector_id: str,
    body: LinkDriveFoldersRequest,
    _principal: Principal = Depends(require_role(*_WRITE_ROLES)),
) -> list[DriveFolderLink]:
    _require_connector(connector_id)
    return link_gdrive_folders(connector_id, body.folder_ids)


@router.get("/{connector_id}/schemas", response_model=list[SchemaTable])
async def get_connector_schemas(
    connector_id: str,
    _principal: Principal = Depends(require_role(*_READ_ROLES)),
) -> list[SchemaTable]:
    _require_connector(connector_id)
    return list_schema_tables(connector_id)
```

- [ ] **Step 2: Crear `routes_gitlab.py`**

```python
from fastapi import APIRouter, Depends

from app.core.security import Principal, require_role
from app.db.session import list_gitlab_catalog
from app.models.schemas import GitLabCatalogEntry

router = APIRouter(prefix="/gitlab", tags=["gitlab"])

_READ_ROLES = ("km-admin", "km-auditor")


@router.get("/catalog", response_model=list[GitLabCatalogEntry])
async def get_gitlab_catalog(_principal: Principal = Depends(require_role(*_READ_ROLES))) -> list[GitLabCatalogEntry]:
    return list_gitlab_catalog()
```

- [ ] **Step 3: Crear `routes_gdrive.py`**

```python
from fastapi import APIRouter, Depends

from app.core.security import Principal, require_role
from app.db.session import list_gdrive_catalog
from app.models.schemas import DriveCatalogEntry

router = APIRouter(prefix="/gdrive", tags=["gdrive"])

_READ_ROLES = ("km-admin", "km-auditor")


@router.get("/catalog", response_model=list[DriveCatalogEntry])
async def get_gdrive_catalog(_principal: Principal = Depends(require_role(*_READ_ROLES))) -> list[DriveCatalogEntry]:
    return list_gdrive_catalog()
```

- [ ] **Step 4: Registrar los nuevos routers en `main.py`**

Modificar los imports y el bloque `include_router` (agregar las dos líneas nuevas después de las existentes):

```python
from app.api.routes_batches import router as batches_router
from app.api.routes_connectors import router as connectors_router
from app.api.routes_gdrive import router as gdrive_router
from app.api.routes_gitlab import router as gitlab_router
```

```python
app.include_router(connectors_router, prefix="/api/v1")
app.include_router(batches_router, prefix="/api/v1")
app.include_router(gitlab_router, prefix="/api/v1")
app.include_router(gdrive_router, prefix="/api/v1")
```

- [ ] **Step 5: Reiniciar ingestion-api y verificar con curl**

Run (matar el proceso en :8001 y relanzar `uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload` desde `portal/services/ingestion-api`), luego:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8001/api/v1/gitlab/catalog
```

Expected: `401` (sin token — confirma que la ruta existe y está protegida, no 404).

- [ ] **Step 6: Commit**

```bash
git add portal/services/ingestion-api/app/api/routes_connectors.py portal/services/ingestion-api/app/api/routes_gitlab.py portal/services/ingestion-api/app/api/routes_gdrive.py portal/services/ingestion-api/app/main.py
git commit -m "feat(ingestion-api): add repo/folder/schema/edit endpoints"
```

---

## Task 3: Rutas proxy BFF

**Files:**
- Create: `portal/bff/src/app/api/ingesta/connectors/[id]/route.ts`
- Create: `portal/bff/src/app/api/ingesta/connectors/[id]/repos/route.ts`
- Create: `portal/bff/src/app/api/ingesta/connectors/[id]/folders/route.ts`
- Create: `portal/bff/src/app/api/ingesta/connectors/[id]/schemas/route.ts`
- Create: `portal/bff/src/app/api/ingesta/gitlab-catalog/route.ts`
- Create: `portal/bff/src/app/api/ingesta/gdrive-catalog/route.ts`
- Modify: `portal/bff/src/middleware.ts`

**Interfaces:**
- Consumes: `getSession()` de `@/lib/session` (ya existente).
- Produces: endpoints BFF que el frontend Angular consume en Task 4.

- [ ] **Step 1: `connectors/[id]/route.ts` (PATCH)**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { id } = await params;
  const upstream = process.env.INGESTION_API_URL ?? "http://localhost:8001";
  const payload = await request.json();
  const response = await fetch(`${upstream}/api/v1/connectors/${id}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  return NextResponse.json(body, { status: response.status });
}
```

- [ ] **Step 2: `connectors/[id]/repos/route.ts` (GET + POST)**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";

const upstream = process.env.INGESTION_API_URL ?? "http://localhost:8001";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  const response = await fetch(`${upstream}/api/v1/connectors/${id}/repos`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  return NextResponse.json(body, { status: response.status });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  const payload = await request.json();
  const response = await fetch(`${upstream}/api/v1/connectors/${id}/repos`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  return NextResponse.json(body, { status: response.status });
}
```

- [ ] **Step 3: `connectors/[id]/folders/route.ts` (GET + POST, mismo patrón que repos)**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";

const upstream = process.env.INGESTION_API_URL ?? "http://localhost:8001";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  const response = await fetch(`${upstream}/api/v1/connectors/${id}/folders`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  return NextResponse.json(body, { status: response.status });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  const payload = await request.json();
  const response = await fetch(`${upstream}/api/v1/connectors/${id}/folders`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  return NextResponse.json(body, { status: response.status });
}
```

- [ ] **Step 4: `connectors/[id]/schemas/route.ts` (GET)**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  const upstream = process.env.INGESTION_API_URL ?? "http://localhost:8001";
  const response = await fetch(`${upstream}/api/v1/connectors/${id}/schemas`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  return NextResponse.json(body, { status: response.status });
}
```

- [ ] **Step 5: `gitlab-catalog/route.ts` y `gdrive-catalog/route.ts` (GET)**

`gitlab-catalog/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export async function GET(): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const upstream = process.env.INGESTION_API_URL ?? "http://localhost:8001";
  const response = await fetch(`${upstream}/api/v1/gitlab/catalog`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  return NextResponse.json(body, { status: response.status });
}
```

`gdrive-catalog/route.ts` (idéntico, cambiando la URL upstream a `/api/v1/gdrive/catalog`):

```typescript
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export async function GET(): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const upstream = process.env.INGESTION_API_URL ?? "http://localhost:8001";
  const response = await fetch(`${upstream}/api/v1/gdrive/catalog`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  return NextResponse.json(body, { status: response.status });
}
```

- [ ] **Step 6: Ampliar el matcher de `middleware.ts` para cubrir las rutas nuevas**

En `portal/bff/src/middleware.ts`, el `config.matcher` actual es
`["/api/ingesta/:path*", "/api/auth/session"]` — ya cubre `/api/ingesta/connectors/[id]/...`,
`/api/ingesta/gitlab-catalog` y `/api/ingesta/gdrive-catalog` porque `:path*` es recursivo.
**No requiere cambios** — verificar leyendo el archivo y confirmar que el patrón sigue así.

- [ ] **Step 7: Reiniciar el BFF y verificar con curl**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/ingesta/gitlab-catalog
```

Expected: `401` (sin sesión).

- [ ] **Step 8: Commit**

```bash
git add portal/bff/src/app/api/ingesta/connectors/\[id\] portal/bff/src/app/api/ingesta/gitlab-catalog portal/bff/src/app/api/ingesta/gdrive-catalog
git commit -m "feat(bff): proxy routes for repo/folder/schema links and catalogs"
```

---

## Task 4: Servicio Angular — métodos nuevos

**Files:**
- Modify: `portal/micro-ui-ingesta/src/app/ingesta-api.service.ts`

**Interfaces:**
- Produces: interfaces `GitLabRepoLink`, `GitLabCatalogEntry`, `DriveFolderLink`,
  `DriveCatalogEntry`, `SchemaTable`, `UpdateConnectorPayload`; métodos
  `listGitlabCatalog()`, `listConnectorRepos(id)`, `linkGitlabRepos(id, repoIds, branchById)`,
  `listGdriveCatalog()`, `listConnectorFolders(id)`, `linkGdriveFolders(id, folderIds)`,
  `listConnectorSchemas(id)`, `updateConnector(id, payload)`.

- [ ] **Step 1: Agregar interfaces y métodos al servicio**

Añadir al final de `ingesta-api.service.ts` (dentro de la clase, antes del cierre `}`, y las
interfaces antes de la clase):

```typescript
export interface GitLabCatalogEntry {
  id: string;
  nombre: string;
  grupo: string;
  rama_default: string;
  ramas_disponibles: string[];
}

export interface GitLabRepoLink {
  id: string;
  connector_id: string;
  repo: string;
  repo_id: string;
  rama: string;
  ruta: string;
  auto_sync: boolean;
  estado: string;
}

export interface DriveCatalogEntry {
  id: string;
  path: string;
  tipo: string;
}

export interface DriveFolderLink {
  id: string;
  connector_id: string;
  path: string;
  tipo: string;
}

export interface SchemaTable {
  id: string;
  connector_id: string;
  tabla: string;
  columnas: number;
  motor: string;
}

export interface UpdateConnectorPayload {
  name?: string;
  base_uri?: string;
  vault_secret_ref?: string;
  active?: boolean;
}
```

Métodos dentro de `IngestaApiService`:

```typescript
  async listGitlabCatalog(): Promise<GitLabCatalogEntry[]> {
    const response = await fetch(`${BFF_BASE_URL}/api/ingesta/gitlab-catalog`, { credentials: "include" });
    if (!response.ok) return [];
    return (await response.json()) as GitLabCatalogEntry[];
  }

  async listConnectorRepos(connectorId: string): Promise<GitLabRepoLink[]> {
    const response = await fetch(`${BFF_BASE_URL}/api/ingesta/connectors/${connectorId}/repos`, { credentials: "include" });
    if (!response.ok) return [];
    return (await response.json()) as GitLabRepoLink[];
  }

  async linkGitlabRepos(connectorId: string, repoIds: string[], branchById: Record<string, string>): Promise<GitLabRepoLink[]> {
    const response = await fetch(`${BFF_BASE_URL}/api/ingesta/connectors/${connectorId}/repos`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo_ids: repoIds, branch_by_id: branchById }),
    });
    if (!response.ok) return [];
    return (await response.json()) as GitLabRepoLink[];
  }

  async listGdriveCatalog(): Promise<DriveCatalogEntry[]> {
    const response = await fetch(`${BFF_BASE_URL}/api/ingesta/gdrive-catalog`, { credentials: "include" });
    if (!response.ok) return [];
    return (await response.json()) as DriveCatalogEntry[];
  }

  async listConnectorFolders(connectorId: string): Promise<DriveFolderLink[]> {
    const response = await fetch(`${BFF_BASE_URL}/api/ingesta/connectors/${connectorId}/folders`, { credentials: "include" });
    if (!response.ok) return [];
    return (await response.json()) as DriveFolderLink[];
  }

  async linkGdriveFolders(connectorId: string, folderIds: string[]): Promise<DriveFolderLink[]> {
    const response = await fetch(`${BFF_BASE_URL}/api/ingesta/connectors/${connectorId}/folders`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder_ids: folderIds }),
    });
    if (!response.ok) return [];
    return (await response.json()) as DriveFolderLink[];
  }

  async listConnectorSchemas(connectorId: string): Promise<SchemaTable[]> {
    const response = await fetch(`${BFF_BASE_URL}/api/ingesta/connectors/${connectorId}/schemas`, { credentials: "include" });
    if (!response.ok) return [];
    return (await response.json()) as SchemaTable[];
  }

  async updateConnector(connectorId: string, payload: UpdateConnectorPayload): Promise<CreateConnectorResult> {
    const response = await fetch(`${BFF_BASE_URL}/api/ingesta/connectors/${connectorId}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const detail =
        body && typeof body === "object" && "detail" in body && typeof body.detail === "string"
          ? body.detail
          : `No se pudo actualizar el conector (HTTP ${response.status}).`;
      return { ok: false, error: detail };
    }
    return { ok: true, connector: body as Connector };
  }
```

- [ ] **Step 2: Verificar compilación**

Run: `cd portal/micro-ui-ingesta && npx tsc --noEmit -p tsconfig.app.json`
Expected: sin errores nuevos relacionados a este archivo.

- [ ] **Step 3: Commit**

```bash
git add portal/micro-ui-ingesta/src/app/ingesta-api.service.ts
git commit -m "feat(micro-ui-ingesta): add API client methods for repos/folders/schemas/edit"
```

---

## Task 5: Pantalla "Administrar repositorios" (GitLab)

**Files:**
- Create: `portal/micro-ui-ingesta/src/app/pages/administrar-repositorios/administrar-repositorios.component.ts`
- Modify: `portal/micro-ui-ingesta/src/app/ingesta.routes.ts`

**Interfaces:**
- Consumes: `IngestaApiService.listGitlabCatalog()`, `.listConnectorRepos(id)`, `.linkGitlabRepos(id, ids, branchById)` de Task 4.

- [ ] **Step 1: Agregar la ruta**

En `ingesta.routes.ts`, agregar dentro del array `INGESTA_ROUTES`:

```typescript
  {
    path: "conectores/:id/repositorios",
    loadComponent: () =>
      import("./pages/administrar-repositorios/administrar-repositorios.component").then((m) => m.AdministrarRepositoriosComponent),
  },
```

- [ ] **Step 2: Crear el componente**

```typescript
import { Component, OnInit, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { ActivatedRoute, Router } from "@angular/router";
import { GitLabCatalogEntry, GitLabRepoLink, IngestaApiService } from "../../ingesta-api.service";

// Pantalla "Administrar repositorios GitLab" del diseño Claude Design: catálogo con
// checkboxes + selector de rama por repo, "Añadir seleccionados", y tabla de ya vinculados.
@Component({
  selector: "km-administrar-repositorios",
  standalone: true,
  imports: [CommonModule],
  template: `
    <div style="padding:24px">
      <button type="button" class="btn btn-ghost" style="padding-inline:0;margin-bottom:12px" (click)="volver()">
        ← Volver a Conectores y Fuentes
      </button>

      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap">
        <input class="input" style="max-width:320px" placeholder="Buscar repositorio por nombre…" [(ngModel)]="filterText" name="filterText" />
        <button type="button" class="btn btn-primary" [disabled]="selectedIds().size === 0 || linking()" (click)="addSelected()">
          {{ linking() ? "Añadiendo…" : "Añadir seleccionados (" + selectedIds().size + ")" }}
        </button>
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
          <tr *ngFor="let entry of filteredCatalog()">
            <td>
              <input
                type="checkbox"
                style="accent-color:var(--color-accent);width:16px;height:16px"
                [checked]="selectedIds().has(entry.id)"
                [disabled]="isLinked(entry.id)"
                (change)="toggleSelected(entry.id)"
              />
            </td>
            <td style="font-family:ui-monospace,Menlo,monospace;font-size:12px">{{ entry.id }}</td>
            <td>{{ entry.nombre }}</td>
            <td class="text-muted">{{ entry.grupo }}</td>
            <td>
              <select class="input" style="height:32px;padding:0 8px" [disabled]="isLinked(entry.id)" (change)="setBranch(entry.id, $event)">
                <option *ngFor="let rama of entry.ramas_disponibles" [value]="rama" [selected]="rama === entry.rama_default">{{ rama }}</option>
              </select>
            </td>
          </tr>
        </tbody>
      </table>
      <div class="text-muted" *ngIf="filteredCatalog().length === 0" style="margin-top:16px">Ningún repositorio coincide con el filtro.</div>

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
  protected filterText = "";
  protected readonly catalog = signal<GitLabCatalogEntry[]>([]);
  protected readonly linkedRepos = signal<GitLabRepoLink[]>([]);
  protected readonly selectedIds = signal<Set<string>>(new Set());
  protected readonly branchById = signal<Record<string, string>>({});
  protected readonly linking = signal(false);

  async ngOnInit(): Promise<void> {
    this.connectorId = this.route.snapshot.paramMap.get("id") ?? "";
    await this.reload();
  }

  private async reload(): Promise<void> {
    const [catalog, linked] = await Promise.all([
      this.api.listGitlabCatalog(),
      this.api.listConnectorRepos(this.connectorId),
    ]);
    this.catalog.set(catalog);
    this.linkedRepos.set(linked);
  }

  protected filteredCatalog(): GitLabCatalogEntry[] {
    const text = this.filterText.trim().toLowerCase();
    const catalog = this.catalog();
    return text ? catalog.filter((entry) => entry.nombre.toLowerCase().includes(text)) : catalog;
  }

  protected isLinked(repoId: string): boolean {
    return this.linkedRepos().some((link) => link.repo_id === repoId);
  }

  protected toggleSelected(repoId: string): void {
    const next = new Set(this.selectedIds());
    if (next.has(repoId)) next.delete(repoId);
    else next.add(repoId);
    this.selectedIds.set(next);
  }

  protected setBranch(repoId: string, event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.branchById.update((current) => ({ ...current, [repoId]: value }));
  }

  protected async addSelected(): Promise<void> {
    if (this.selectedIds().size === 0) return;
    this.linking.set(true);
    try {
      await this.api.linkGitlabRepos(this.connectorId, [...this.selectedIds()], this.branchById());
      this.selectedIds.set(new Set());
      await this.reload();
    } finally {
      this.linking.set(false);
    }
  }

  protected volver(): void {
    void this.router.navigate(["/ingesta/conectores"]);
  }
}
```

- [ ] **Step 2: Verificar compilación y navegación manual**

Run: `cd portal/micro-ui-ingesta && npx ng build` (o dejar `ng serve` corriendo y observar
recompilación sin errores).

Navegar a `http://localhost:4201/conectores/gitlab-enterprise/repositorios` en el navegador
y confirmar que la tabla de catálogo y la de vinculados se renderizan (vacía la segunda si
no hay repos vinculados aún).

- [ ] **Step 3: Commit**

```bash
git add portal/micro-ui-ingesta/src/app/pages/administrar-repositorios portal/micro-ui-ingesta/src/app/ingesta.routes.ts
git commit -m "feat(micro-ui-ingesta): add Administrar repositorios screen"
```

---

## Task 6: Pantalla "Seleccionar carpetas" (Google Drive)

**Files:**
- Create: `portal/micro-ui-ingesta/src/app/pages/seleccionar-carpetas/seleccionar-carpetas.component.ts`
- Modify: `portal/micro-ui-ingesta/src/app/ingesta.routes.ts`

**Interfaces:**
- Consumes: `IngestaApiService.listGdriveCatalog()`, `.listConnectorFolders(id)`, `.linkGdriveFolders(id, ids)` de Task 4.

- [ ] **Step 1: Agregar la ruta**

En `ingesta.routes.ts`:

```typescript
  {
    path: "conectores/:id/carpetas",
    loadComponent: () =>
      import("./pages/seleccionar-carpetas/seleccionar-carpetas.component").then((m) => m.SeleccionarCarpetasComponent),
  },
```

- [ ] **Step 2: Crear el componente (mismo patrón que Task 5, sin selector de rama)**

```typescript
import { Component, OnInit, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { ActivatedRoute, Router } from "@angular/router";
import { DriveCatalogEntry, DriveFolderLink, IngestaApiService } from "../../ingesta-api.service";

// Pantalla dedicada "Seleccionar carpetas" para conectores Google Drive — mismo patrón que
// Administrar repositorios (catálogo + selección + vinculados), sin selector de rama.
@Component({
  selector: "km-seleccionar-carpetas",
  standalone: true,
  imports: [CommonModule],
  template: `
    <div style="padding:24px">
      <button type="button" class="btn btn-ghost" style="padding-inline:0;margin-bottom:12px" (click)="volver()">
        ← Volver a Conectores y Fuentes
      </button>

      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap">
        <input class="input" style="max-width:320px" placeholder="Buscar carpeta por nombre…" [(ngModel)]="filterText" name="filterText" />
        <button type="button" class="btn btn-primary" [disabled]="selectedIds().size === 0 || linking()" (click)="addSelected()">
          {{ linking() ? "Añadiendo…" : "Añadir seleccionadas (" + selectedIds().size + ")" }}
        </button>
      </div>

      <table class="table">
        <thead>
          <tr><th style="width:32px"></th><th>Carpeta</th><th>Tipo</th></tr>
        </thead>
        <tbody>
          <tr *ngFor="let entry of filteredCatalog()">
            <td>
              <input
                type="checkbox"
                style="accent-color:var(--color-accent);width:16px;height:16px"
                [checked]="selectedIds().has(entry.id)"
                [disabled]="isLinked(entry.id)"
                (change)="toggleSelected(entry.id)"
              />
            </td>
            <td>{{ entry.path }}</td>
            <td class="text-muted">{{ entry.tipo }}</td>
          </tr>
        </tbody>
      </table>
      <div class="text-muted" *ngIf="filteredCatalog().length === 0" style="margin-top:16px">Ninguna carpeta coincide con el filtro.</div>

      <h4 style="margin-top:28px">Carpetas ya vinculadas</h4>
      <table class="table" style="margin-top:10px">
        <thead><tr><th>Carpeta</th><th>Tipo</th></tr></thead>
        <tbody>
          <tr *ngFor="let link of linkedFolders()">
            <td>{{ link.path }}</td>
            <td class="text-muted">{{ link.tipo }}</td>
          </tr>
          <tr *ngIf="linkedFolders().length === 0">
            <td colspan="2" class="text-muted">Sin carpetas vinculadas todavía.</td>
          </tr>
        </tbody>
      </table>
    </div>
  `,
})
export class SeleccionarCarpetasComponent implements OnInit {
  private readonly api = inject(IngestaApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private connectorId = "";
  protected filterText = "";
  protected readonly catalog = signal<DriveCatalogEntry[]>([]);
  protected readonly linkedFolders = signal<DriveFolderLink[]>([]);
  protected readonly selectedIds = signal<Set<string>>(new Set());
  protected readonly linking = signal(false);

  async ngOnInit(): Promise<void> {
    this.connectorId = this.route.snapshot.paramMap.get("id") ?? "";
    await this.reload();
  }

  private async reload(): Promise<void> {
    const [catalog, linked] = await Promise.all([
      this.api.listGdriveCatalog(),
      this.api.listConnectorFolders(this.connectorId),
    ]);
    this.catalog.set(catalog);
    this.linkedFolders.set(linked);
  }

  protected filteredCatalog(): DriveCatalogEntry[] {
    const text = this.filterText.trim().toLowerCase();
    const catalog = this.catalog();
    return text ? catalog.filter((entry) => entry.path.toLowerCase().includes(text)) : catalog;
  }

  protected isLinked(folderId: string): boolean {
    return this.linkedFolders().some((link) => link.id.endsWith(`-${folderId}`));
  }

  protected toggleSelected(folderId: string): void {
    const next = new Set(this.selectedIds());
    if (next.has(folderId)) next.delete(folderId);
    else next.add(folderId);
    this.selectedIds.set(next);
  }

  protected async addSelected(): Promise<void> {
    if (this.selectedIds().size === 0) return;
    this.linking.set(true);
    try {
      await this.api.linkGdriveFolders(this.connectorId, [...this.selectedIds()]);
      this.selectedIds.set(new Set());
      await this.reload();
    } finally {
      this.linking.set(false);
    }
  }

  protected volver(): void {
    void this.router.navigate(["/ingesta/conectores"]);
  }
}
```

- [ ] **Step 2: Verificar compilación**

Run: dejar `ng serve` corriendo, confirmar recompilación sin errores; navegar a
`http://localhost:4201/conectores/drive-corp/carpetas`.

- [ ] **Step 3: Commit**

```bash
git add portal/micro-ui-ingesta/src/app/pages/seleccionar-carpetas portal/micro-ui-ingesta/src/app/ingesta.routes.ts
git commit -m "feat(micro-ui-ingesta): add Seleccionar carpetas screen"
```

---

## Task 7: Pantalla "Esquemas mapeados"

**Files:**
- Create: `portal/micro-ui-ingesta/src/app/pages/esquemas-mapeados/esquemas-mapeados.component.ts`
- Modify: `portal/micro-ui-ingesta/src/app/ingesta.routes.ts`

**Interfaces:**
- Consumes: `IngestaApiService.listConnectorSchemas(id)` de Task 4.

- [ ] **Step 1: Agregar la ruta**

```typescript
  {
    path: "conectores/:id/esquemas",
    loadComponent: () =>
      import("./pages/esquemas-mapeados/esquemas-mapeados.component").then((m) => m.EsquemasMapeadosComponent),
  },
```

- [ ] **Step 2: Crear el componente**

```typescript
import { Component, OnInit, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { ActivatedRoute, Router } from "@angular/router";
import { IngestaApiService, SchemaTable } from "../../ingesta-api.service";

// Vista de solo lectura "Esquemas mapeados" para conectores de tipo Base de datos —
// tablas/esquemas descubiertos, sin filas ni datos operativos (FR-12).
@Component({
  selector: "km-esquemas-mapeados",
  standalone: true,
  imports: [CommonModule],
  template: `
    <div style="padding:24px">
      <button type="button" class="btn btn-ghost" style="padding-inline:0;margin-bottom:12px" (click)="volver()">
        ← Volver a Conectores y Fuentes
      </button>
      <h2 style="margin:0">Esquemas mapeados</h2>
      <div class="text-muted" style="font-size:13px;margin-bottom:16px">
        Solo metadata de tablas — sin filas ni datos operativos (FR-12)
      </div>
      <table class="table">
        <thead><tr><th>Tabla</th><th>Motor</th><th>Columnas</th></tr></thead>
        <tbody>
          <tr *ngFor="let table of tables()">
            <td>{{ table.tabla }}</td>
            <td><span class="tag tag-outline">{{ table.motor }}</span></td>
            <td>{{ table.columnas }}</td>
          </tr>
          <tr *ngIf="tables().length === 0">
            <td colspan="3" class="text-muted">Sin esquemas mapeados todavía.</td>
          </tr>
        </tbody>
      </table>
    </div>
  `,
})
export class EsquemasMapeadosComponent implements OnInit {
  private readonly api = inject(IngestaApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly tables = signal<SchemaTable[]>([]);

  async ngOnInit(): Promise<void> {
    const connectorId = this.route.snapshot.paramMap.get("id") ?? "";
    this.tables.set(await this.api.listConnectorSchemas(connectorId));
  }

  protected volver(): void {
    void this.router.navigate(["/ingesta/conectores"]);
  }
}
```

- [ ] **Step 3: Verificar compilación y navegación manual**

- [ ] **Step 4: Commit**

```bash
git add portal/micro-ui-ingesta/src/app/pages/esquemas-mapeados portal/micro-ui-ingesta/src/app/ingesta.routes.ts
git commit -m "feat(micro-ui-ingesta): add Esquemas mapeados screen"
```

---

## Task 8: Panel "Editar conector" (Configurar)

**Files:**
- Create: `portal/micro-ui-ingesta/src/app/pages/conectores/editar-conector.component.ts`

**Interfaces:**
- Consumes: `IngestaApiService.updateConnector(id, payload)` de Task 4.
- Produces: componente `EditarConectorComponent` con `@Input() connector: Connector`,
  `@Output() closed = new EventEmitter<Connector | null>()` (emite el conector actualizado
  al guardar, o `null` al cancelar) — consumido por Task 9.

- [ ] **Step 1: Crear el componente**

```typescript
import { Component, EventEmitter, Input, Output, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { Connector, IngestaApiService } from "../../ingesta-api.service";
import { inject } from "@angular/core";

// Panel lateral "Configurar" — edita nombre/base_uri/vault_secret_ref/active de un
// conector existente. Reutilizable por los 4 tipos de conector.
@Component({
  selector: "km-editar-conector",
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="dialog-backdrop" style="position:fixed;inset:0;z-index:60" (click)="cancel()">
      <div class="dialog" style="position:relative" (click)="$event.stopPropagation()">
        <div class="dialog-title">Configurar {{ connector.name }}</div>
        <div class="dialog-body">Edita los datos del conector. La credencial en Vault solo se referencia, nunca se muestra.</div>

        <div class="field" style="margin-bottom:12px">
          <label>Nombre</label>
          <input class="input" [(ngModel)]="form.name" name="name" />
        </div>
        <div class="field" style="margin-bottom:12px">
          <label>Base URI</label>
          <input class="input" [(ngModel)]="form.base_uri" name="base_uri" />
        </div>
        <div class="field" style="margin-bottom:12px">
          <label>Referencia Vault</label>
          <input class="input" [(ngModel)]="form.vault_secret_ref" name="vault_secret_ref" />
        </div>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;margin-bottom:4px">
          <input type="checkbox" [(ngModel)]="form.active" name="active" style="accent-color:var(--color-accent);width:16px;height:16px" />
          Activo
        </label>

        <div class="text-muted" style="font-size:12px;margin-top:8px" *ngIf="error()">{{ error() }}</div>

        <div class="dialog-actions">
          <button type="button" class="btn btn-secondary" (click)="cancel()" [disabled]="saving()">Cancelar</button>
          <button type="button" class="btn btn-primary" (click)="save()" [disabled]="saving()">
            {{ saving() ? "Guardando…" : "Guardar cambios" }}
          </button>
        </div>
      </div>
    </div>
  `,
})
export class EditarConectorComponent {
  private readonly api = inject(IngestaApiService);

  @Input({ required: true }) connector!: Connector;
  @Output() closed = new EventEmitter<Connector | null>();

  protected form = { name: "", base_uri: "", vault_secret_ref: "", active: true };
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  ngOnChanges(): void {
    this.form = {
      name: this.connector.name,
      base_uri: this.connector.base_uri,
      vault_secret_ref: this.connector.vault_secret_ref,
      active: this.connector.active,
    };
  }

  protected cancel(): void {
    this.closed.emit(null);
  }

  protected async save(): Promise<void> {
    this.saving.set(true);
    this.error.set(null);
    try {
      const result = await this.api.updateConnector(this.connector.id, this.form);
      if (!result.ok) {
        this.error.set(result.error ?? "No se pudo actualizar el conector.");
        return;
      }
      this.closed.emit(result.connector!);
    } catch {
      this.error.set("Error de red o del servidor al actualizar el conector.");
    } finally {
      this.saving.set(false);
    }
  }
}
```

- [ ] **Step 2: Verificar compilación**

- [ ] **Step 3: Commit**

```bash
git add portal/micro-ui-ingesta/src/app/pages/conectores/editar-conector.component.ts
git commit -m "feat(micro-ui-ingesta): add Editar conector panel"
```

---

## Task 9: Integrar todo en `conectores.component.ts`

**Files:**
- Modify: `portal/micro-ui-ingesta/src/app/pages/conectores/conectores.component.ts`

**Interfaces:**
- Consumes: `EditarConectorComponent` de Task 8; rutas de Tasks 5-7; `IngestaApiService.listConnectorRepos`,
  `.updateConnector` de Task 4.

- [ ] **Step 1: Reescribir el componente completo**

```typescript
import { Component, OnInit, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { Router, RouterLink } from "@angular/router";
import { Connector, GitLabRepoLink, IngestaApiService } from "../../ingesta-api.service";
import { EditarConectorComponent } from "./editar-conector.component";

interface NewConnectorForm {
  kind: string;
  name: string;
  base_uri: string;
  vault_secret_ref: string;
}

function emptyForm(): NewConnectorForm {
  return { kind: "gitlab", name: "", base_uri: "", vault_secret_ref: "" };
}

@Component({
  selector: "km-conectores",
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, EditarConectorComponent],
  template: `
    <div style="padding:24px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;margin-bottom:20px">
        <div>
          <h2 style="margin:0">Conectores y fuentes</h2>
          <div class="text-muted" style="font-size:13px">Administración de conectores GitLab, Drive, upload y esquema</div>
        </div>
        <button type="button" class="btn btn-primary" style="white-space:nowrap" (click)="openDialog()">
          + Nuevo conector
        </button>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;margin-bottom:24px">
        <div class="card" style="padding:18px" *ngFor="let c of connectors()">
          <div style="display:flex;justify-content:space-between;align-items:flex-start">
            <div>
              <div class="card-title">{{ c.name }}</div>
              <div class="text-muted" style="font-size:12px">{{ c.base_uri }}</div>
            </div>
            <span class="tag" [class.tag-accent]="c.healthy" [class.tag-neutral]="!c.healthy">
              {{ c.active ? "Activo" : "Pausado" }} · {{ c.healthy ? "Saludable" : "Con incidencias" }}
            </span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0">
            <div>
              <div class="text-muted" style="font-size:10px;letter-spacing:0.05em">CREDENCIAL EN VAULT</div>
              <div style="font-size:12px;font-family:ui-monospace,Menlo,monospace">{{ c.vault_secret_ref }}</div>
            </div>
            <div>
              <div class="text-muted" style="font-size:10px;letter-spacing:0.05em">TIPO</div>
              <div style="font-size:13px">{{ c.kind }}</div>
            </div>
          </div>
          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px">
            <button type="button" class="btn btn-secondary" (click)="configurar(c)">Configurar</button>
            <a *ngIf="c.kind === 'gitlab'" class="btn btn-primary" [routerLink]="['/ingesta/conectores', c.id, 'repositorios']">Administrar repositorios</a>
            <a *ngIf="c.kind === 'google_drive'" class="btn btn-primary" [routerLink]="['/ingesta/conectores', c.id, 'carpetas']">Seleccionar carpetas</a>
            <a *ngIf="c.kind === 'schema'" class="btn btn-primary" [routerLink]="['/ingesta/conectores', c.id, 'esquemas']">Esquemas mapeados</a>
          </div>
        </div>

        <div class="text-muted" *ngIf="connectors().length === 0">Sin conectores configurados todavia.</div>
      </div>

      <div class="card" style="padding:18px" *ngIf="gitlabConnector() as gc">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px">
          <div>
            <div class="text-muted" style="font-size:11px;letter-spacing:0.06em;text-transform:uppercase">
              Detalle operacional / {{ gc.name }}
            </div>
            <h4 style="margin:2px 0 4px">Configuración de repositorios &amp; rutas activas</h4>
            <div class="text-muted" style="font-size:12px">
              Control granular de trazabilidad: seguimiento estricto de ramas, subdirectorios restringidos y sincronización automática.
            </div>
          </div>
          <div style="display:flex;gap:10px;align-items:center">
            <input class="input" style="max-width:220px" placeholder="Filtrar por repo o rama…" [(ngModel)]="repoFilterText" name="repoFilterText" />
            <a class="btn btn-secondary" style="white-space:nowrap" [routerLink]="['/ingesta/conectores', gc.id, 'repositorios']">Vincular nuevo repo</a>
          </div>
        </div>
        <table class="table" style="margin-top:12px">
          <thead>
            <tr><th>Repositorio</th><th>Rama rastreada</th><th>Ruta</th><th>Auto-sync</th><th>Estado</th></tr>
          </thead>
          <tbody>
            <tr *ngFor="let rd of filteredRepoDetails()">
              <td>{{ rd.repo }}</td>
              <td><span class="tag tag-outline">{{ rd.rama }}</span></td>
              <td style="font-size:13px">{{ rd.ruta }}</td>
              <td><span class="tag" [class.tag-accent]="rd.auto_sync" [class.tag-neutral]="!rd.auto_sync">{{ rd.auto_sync ? "Activado" : "Pausado" }}</span></td>
              <td><span class="tag tag-accent">{{ rd.estado }}</span></td>
            </tr>
            <tr *ngIf="filteredRepoDetails().length === 0">
              <td colspan="5" class="text-muted">Sin repositorios vinculados todavía.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div *ngIf="dialogOpen()" class="dialog-backdrop" style="position:fixed;inset:0;z-index:50" (click)="closeDialog()">
      <div class="dialog" style="position:relative" (click)="$event.stopPropagation()">
        <div class="dialog-title">Nuevo conector</div>
        <div class="dialog-body">
          Registra un conector autorizado. Solo se guarda la referencia Vault del secreto — nunca la credencial en si (FR-01).
        </div>

        <div class="field" style="margin-bottom:12px">
          <label>Tipo</label>
          <select class="input" [(ngModel)]="form.kind" name="kind">
            <option value="gitlab">GitLab</option>
            <option value="google_drive">Google Drive</option>
            <option value="upload">Carga manual</option>
            <option value="schema">Catálogo de esquemas</option>
          </select>
        </div>
        <div class="field" style="margin-bottom:12px">
          <label>Nombre</label>
          <input class="input" [(ngModel)]="form.name" name="name" placeholder="GitLab Enterprise Server" />
        </div>
        <div class="field" style="margin-bottom:12px">
          <label>Base URI</label>
          <input class="input" [(ngModel)]="form.base_uri" name="base_uri" placeholder="https://gitlab.internal.comsatel.pe" />
        </div>
        <div class="field" style="margin-bottom:4px">
          <label>Referencia Vault</label>
          <input class="input" [(ngModel)]="form.vault_secret_ref" name="vault_secret_ref" placeholder="secrets/kb/gitlab" />
        </div>

        <div class="text-muted" style="font-size:12px;margin-top:8px" *ngIf="dialogError()">{{ dialogError() }}</div>

        <div class="dialog-actions">
          <button type="button" class="btn btn-secondary" (click)="closeDialog()" [disabled]="submitting()">Cancelar</button>
          <button type="button" class="btn btn-primary" (click)="submit()" [disabled]="submitting() || !canSubmit()">
            {{ submitting() ? "Guardando…" : "Registrar conector" }}
          </button>
        </div>
      </div>
    </div>

    <km-editar-conector *ngIf="editingConnector() as ec" [connector]="ec" (closed)="onEditClosed($event)" />
  `,
})
export class ConectoresComponent implements OnInit {
  private readonly api = inject(IngestaApiService);
  protected readonly connectors = signal<Connector[]>([]);
  protected readonly repoDetails = signal<GitLabRepoLink[]>([]);
  protected repoFilterText = "";

  protected readonly dialogOpen = signal(false);
  protected readonly submitting = signal(false);
  protected readonly dialogError = signal<string | null>(null);
  protected form: NewConnectorForm = emptyForm();

  protected readonly editingConnector = signal<Connector | null>(null);

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  private async reload(): Promise<void> {
    const connectors = await this.api.listConnectors();
    this.connectors.set(connectors);
    const gitlab = connectors.find((c) => c.kind === "gitlab");
    this.repoDetails.set(gitlab ? await this.api.listConnectorRepos(gitlab.id) : []);
  }

  protected gitlabConnector(): Connector | null {
    return this.connectors().find((c) => c.kind === "gitlab") ?? null;
  }

  protected filteredRepoDetails(): GitLabRepoLink[] {
    const text = this.repoFilterText.trim().toLowerCase();
    const details = this.repoDetails();
    return text ? details.filter((rd) => rd.repo.toLowerCase().includes(text) || rd.rama.toLowerCase().includes(text)) : details;
  }

  protected configurar(connector: Connector): void {
    this.editingConnector.set(connector);
  }

  protected async onEditClosed(updated: Connector | null): Promise<void> {
    this.editingConnector.set(null);
    if (updated) await this.reload();
  }

  protected openDialog(): void {
    this.form = emptyForm();
    this.dialogError.set(null);
    this.dialogOpen.set(true);
  }

  protected closeDialog(): void {
    if (this.submitting()) return;
    this.dialogOpen.set(false);
  }

  protected canSubmit(): boolean {
    return this.form.name.trim().length > 0 && this.form.base_uri.trim().length > 0 && this.form.vault_secret_ref.trim().length > 0;
  }

  protected async submit(): Promise<void> {
    if (!this.canSubmit()) return;
    this.submitting.set(true);
    this.dialogError.set(null);

    try {
      const result = await this.api.createConnector(this.form);
      if (!result.ok) {
        this.dialogError.set(result.error ?? "No se pudo crear el conector.");
        return;
      }
      this.dialogOpen.set(false);
      await this.reload();
    } catch {
      this.dialogError.set("Error de red o del servidor al crear el conector.");
    } finally {
      this.submitting.set(false);
    }
  }
}
```

Nota: este Task 9 mantiene el diálogo de creación centrado (`.dialog`) tal como está — el
rediseño al panel lateral se hace en Task 10, que reemplaza únicamente ese bloque de template
y los campos del formulario.

- [ ] **Step 2: Verificar compilación**

Run: dejar `ng serve` corriendo, confirmar recompilación sin errores.

- [ ] **Step 3: Verificación manual end-to-end**

Con sesión autenticada y rol `km-admin`, navegar a `/ingesta/conectores` y confirmar:
- La sección "Detalle operacional / GitLab Enterprise Server" aparece con la tabla de repos.
- "Configurar" abre el panel de edición y guarda cambios (verificar que el nombre se
  actualiza en la tarjeta tras guardar).
- El botón primario de cada tarjeta (Administrar repositorios / Seleccionar carpetas /
  Esquemas mapeados) navega a la pantalla correspondiente según el `kind` del conector.

- [ ] **Step 4: Commit**

```bash
git add portal/micro-ui-ingesta/src/app/pages/conectores/conectores.component.ts
git commit -m "feat(micro-ui-ingesta): wire detail table, Configurar and per-type actions"
```

---

## Task 10: Rediseño del panel "Nuevo conector" (slide-over lateral)

**Files:**
- Modify: `portal/micro-ui-ingesta/src/app/pages/conectores/conectores.component.ts`

**Interfaces:**
- Consumes: `IngestaApiService.createConnector` (ya existente, sin cambios de firma).

- [ ] **Step 1: Reemplazar el bloque del diálogo de creación en el template**

En el `template` de `ConectoresComponent` (Task 9), reemplazar el bloque completo
`<div *ngIf="dialogOpen()" class="dialog-backdrop" ...> ... </div>` (el diálogo de "Nuevo
conector") por:

```html
    <div *ngIf="dialogOpen()" style="position:fixed;inset:0;background:rgba(15,23,42,0.45);z-index:50;display:flex;justify-content:flex-end" (click)="closeDialog()">
      <div style="background:var(--color-bg);width:440px;max-width:100%;height:100%;box-shadow:var(--shadow-lg);display:flex;flex-direction:column" (click)="$event.stopPropagation()">
        <div style="padding:20px 24px;border-bottom:1px solid var(--color-divider);display:flex;justify-content:space-between;align-items:center">
          <div>
            <h4 style="margin:0">Nuevo conector</h4>
            <div class="text-muted" style="font-size:12px;margin-top:2px">Registra un origen de datos autorizado</div>
          </div>
          <button type="button" class="btn btn-ghost btn-icon" (click)="closeDialog()">✕</button>
        </div>

        <div style="flex:1;overflow-y:auto;padding:24px;display:flex;flex-direction:column;gap:16px">
          <div class="field">
            <label>Tipo de conector</label>
            <div class="seg" style="width:100%">
              <label
                *ngFor="let type of connectorTypes"
                class="seg-opt"
                [style.background]="form.kind === type.key ? 'var(--color-accent)' : 'transparent'"
                [style.color]="form.kind === type.key ? '#fff' : 'var(--color-neutral-700)'"
                (click)="form.kind = type.key"
              >
                {{ type.label }}
              </label>
            </div>
          </div>

          <div class="field">
            <label>Nombre</label>
            <input class="input" [(ngModel)]="form.name" name="name" placeholder="p. ej. GitLab Enterprise Server" />
          </div>
          <div class="field">
            <label>Descripción</label>
            <input class="input" [(ngModel)]="form.descripcion" name="descripcion" placeholder="Propósito y alcance del conector" />
          </div>

          <ng-container [ngSwitch]="form.kind">
            <div class="field" *ngSwitchCase="'gitlab'">
              <label>URL del servidor GitLab</label>
              <input class="input" [(ngModel)]="form.base_uri" name="base_uri" placeholder="https://gitlab.internal.comsatel.pe" />
            </div>
            <div class="field" *ngSwitchCase="'google_drive'"></div>
            <div class="field" *ngSwitchCase="'db'"></div>
          </ng-container>
          <div class="field">
            <label>{{ vaultLabel() }}</label>
            <input class="input" [(ngModel)]="form.vault_secret_ref" name="vault_secret_ref" [placeholder]="vaultPlaceholder()" />
            <div class="text-muted" style="font-size:11px">Referencia a la ruta en Vault. El secreto nunca se ingresa aquí.</div>
          </div>

          <div class="card" style="padding:12px" *ngIf="testResult() as result" [style.background]="result.bg">
            <div style="font-size:13px" [style.color]="result.color">{{ result.message }}</div>
          </div>
          <div class="text-muted" style="font-size:12px" *ngIf="dialogError()">{{ dialogError() }}</div>
        </div>

        <div style="padding:16px 24px;border-top:1px solid var(--color-divider);display:flex;justify-content:flex-end;gap:10px">
          <button type="button" class="btn btn-secondary" (click)="testConnection()">Verificar conectividad</button>
          <button type="button" class="btn btn-primary" [disabled]="submitting() || !canSubmit()" (click)="submit()">
            {{ submitting() ? "Guardando…" : "Guardar" }}
          </button>
        </div>
      </div>
    </div>
```

- [ ] **Step 2: Actualizar la clase del componente**

Cambiar `NewConnectorForm`/`emptyForm` para incluir `descripcion`, limitar `kind` a
gitlab/google_drive/db en el selector, y agregar `connectorTypes`, `vaultLabel()`,
`vaultPlaceholder()`, `testResult`, `testConnection()`:

```typescript
interface NewConnectorForm {
  kind: string;
  name: string;
  descripcion: string;
  base_uri: string;
  vault_secret_ref: string;
}

function emptyForm(): NewConnectorForm {
  return { kind: "gitlab", name: "", descripcion: "", base_uri: "", vault_secret_ref: "" };
}

interface TestResult {
  message: string;
  bg: string;
  color: string;
}
```

En la clase `ConectoresComponent`, agregar:

```typescript
  protected readonly connectorTypes = [
    { key: "gitlab", label: "GitLab" },
    { key: "google_drive", label: "Google Drive" },
    { key: "db", label: "Base de datos" },
  ];
  protected readonly testResult = signal<TestResult | null>(null);

  protected vaultLabel(): string {
    if (this.form.kind === "gitlab") return "Credencial en Vault (Personal Access Token)";
    if (this.form.kind === "google_drive") return "Credencial en Vault (Service Account JSON)";
    return "Credencial en Vault (usuario / password / host / puerto)";
  }

  protected vaultPlaceholder(): string {
    if (this.form.kind === "gitlab") return "secrets/kb/gitlab";
    if (this.form.kind === "google_drive") return "secrets/kb/drive";
    return "secrets/kb/db-catalog";
  }

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

Modificar `openDialog()` para también resetear `testResult`:

```typescript
  protected openDialog(): void {
    this.form = emptyForm();
    this.dialogError.set(null);
    this.testResult.set(null);
    this.dialogOpen.set(true);
  }
```

`form.kind` ahora solo toma `gitlab`/`google_drive`/`db` desde este panel, pero el backend
sigue aceptando `upload`/`schema` como `ConnectorKind` válido (creables solo vía API directa,
no desde esta UI) — coherente con el mockup.

- [ ] **Step 3: Verificar compilación y prueba manual**

Abrir "+ Nuevo conector", confirmar que el panel se desliza desde la derecha, cambiar de
tipo y ver los campos condicionales, pulsar "Verificar conectividad" y ver el mensaje de
éxito tras ~800ms, guardar y confirmar que aparece en el grid.

- [ ] **Step 4: Commit**

```bash
git add portal/micro-ui-ingesta/src/app/pages/conectores/conectores.component.ts
git commit -m "feat(micro-ui-ingesta): redesign Nuevo conector as side panel with connectivity test"
```

---

## Self-Review Notes

- **Cobertura de spec:** Task 1-2 cubren el modelo de datos y endpoints; Task 3 el proxy BFF;
  Task 4 el cliente; Tasks 5-7 las tres pantallas dedicadas; Task 8-9 "Configurar" y su
  integración; Task 10 el rediseño del diálogo de creación. Los 4 puntos de la spec están
  cubiertos.
- **Consistencia de tipos:** `GitLabRepoLink`/`DriveFolderLink`/`SchemaTable` se definen
  idénticos en backend (Task 1) y frontend (Task 4) — mismos nombres de campo en snake_case
  (el frontend no transforma a camelCase, coherente con `Connector`/`IngestionBatch` ya
  existentes en `ingesta-api.service.ts`).
- **Sin placeholders:** cada step incluye código completo, no descripciones de alto nivel.
