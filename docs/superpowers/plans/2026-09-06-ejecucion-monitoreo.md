# Ejecución y monitoreo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new "Ejecución y monitoreo" screen to the portal that lists ingestion batches as
actionable job cards, with manual "Iniciar"/"Reintentar" (queued/failed → processing) and a bulk
"Ejecutar pendientes" action — no automatic progress engine.

**Architecture:** One new backend endpoint (`POST /batches/{id}/start`) backed by a new store
function that validates the state transition; a BFF proxy route mirroring the existing pattern;
a new Angular page consuming a new service method; a new sidebar nav link.

**Tech Stack:** FastAPI + pydantic (backend), Angular 18 standalone components (frontend),
Next.js route handlers (BFF proxy).

**Spec:** `docs/superpowers/specs/2026-09-06-ejecucion-monitoreo-design.md`

## Global Constraints

- No automatic progress/status advancement — `processed`/`total` are never touched by this plan;
  only `status` transitions, and only via explicit user action.
- `POST /batches/{id}/start` only succeeds from `queued` or `failed` — any other current status is
  a 409, unknown id is a 404. Gated to `_TRIGGER_ROLES = ("km-admin", "km-operador")` (same set as
  the existing `POST /batches`).
- No batch-detail view in this plan — "Ver detalle" renders disabled for
  `indexed`/`draft_created`/`skipped`/`stale`.
- No role-based hiding of the new nav item in the shell — authorization is enforced server-side
  only, matching the rest of the portal.

---

### Task 1: `start_batch` store function

**Files:**
- Modify: `portal/services/ingestion-api/app/db/session.py`
- Test: `portal/services/ingestion-api/tests/db/test_session_batches.py` (new; create
  `portal/services/ingestion-api/tests/db/__init__.py` if it doesn't already exist — it does, from
  an earlier plan, so just add the new test file)

**Interfaces:**
- Consumes: `BatchStatus`, `IngestionBatch` (existing, from `app/models/schemas.py` — unchanged),
  `_batches: dict[str, IngestionBatch]` (existing module-level store in `db/session.py`).
- Produces (used by Task 2):
  ```python
  class InvalidBatchTransitionError(Exception):
      """Raised when start_batch is called on a batch not in `queued` or `failed`."""

  def start_batch(batch_id: str) -> IngestionBatch | None:
      """Returns None if batch_id doesn't exist. Raises InvalidBatchTransitionError if the
      batch's current status isn't `queued` or `failed`. Otherwise transitions it to
      `processing`, refreshes `updated_at`, and returns the updated batch."""
  ```

- [ ] **Step 1: Write the failing test**

Create `portal/services/ingestion-api/tests/db/test_session_batches.py`:

```python
import pytest

from app.db.session import _batches, create_batch, start_batch, InvalidBatchTransitionError
from app.models.schemas import BatchStatus


def test_start_batch_from_queued_transitions_to_processing() -> None:
    batch = create_batch(connector_id="c1", source_uri="gitlab://x", artifact_type="markdown", total=10)
    assert batch.status == BatchStatus.queued

    updated = start_batch(batch.id)

    assert updated is not None
    assert updated.status == BatchStatus.processing
    assert updated.id == batch.id


def test_start_batch_from_failed_transitions_to_processing() -> None:
    batch = create_batch(connector_id="c2", source_uri="gitlab://y", artifact_type="markdown", total=5)
    _batches[batch.id] = batch.model_copy(update={"status": BatchStatus.failed})

    updated = start_batch(batch.id)

    assert updated is not None
    assert updated.status == BatchStatus.processing


def test_start_batch_from_processing_raises() -> None:
    batch = create_batch(connector_id="c3", source_uri="gitlab://z", artifact_type="markdown", total=1)
    _batches[batch.id] = batch.model_copy(update={"status": BatchStatus.processing})

    with pytest.raises(InvalidBatchTransitionError):
        start_batch(batch.id)


def test_start_batch_unknown_id_returns_none() -> None:
    assert start_batch("does-not-exist") is None
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `portal/services/ingestion-api/`):
`.venv/Scripts/python.exe -m pytest tests/db/test_session_batches.py -v`
Expected: FAIL with `ImportError: cannot import name 'start_batch' from 'app.db.session'`

- [ ] **Step 3: Write the implementation**

In `portal/services/ingestion-api/app/db/session.py`, add near the existing batch functions
(`list_batches`, `create_batch`):

```python
class InvalidBatchTransitionError(Exception):
    """Raised when start_batch is called on a batch not in `queued` or `failed`."""


def start_batch(batch_id: str) -> IngestionBatch | None:
    existing = _batches.get(batch_id)
    if existing is None:
        return None
    if existing.status not in (BatchStatus.queued, BatchStatus.failed):
        raise InvalidBatchTransitionError(
            f"Batch {batch_id} is in status {existing.status}, cannot start"
        )
    updated = existing.model_copy(update={"status": BatchStatus.processing, "updated_at": datetime.now(UTC)})
    _batches[batch_id] = updated
    return updated
```

`datetime` and `UTC` are already imported at the top of this file (used by `create_batch`) — no
new import needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/Scripts/python.exe -m pytest tests/db/test_session_batches.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add portal/services/ingestion-api/app/db/session.py portal/services/ingestion-api/tests/db/test_session_batches.py
git commit -m "feat(ingestion-api): add start_batch store function for manual batch state transitions"
```

---

### Task 2: `POST /batches/{id}/start` route

**Files:**
- Modify: `portal/services/ingestion-api/app/api/routes_batches.py`
- Test: `portal/services/ingestion-api/tests/api/test_routes_batches.py` (new)

**Interfaces:**
- Consumes: `start_batch`, `InvalidBatchTransitionError` (Task 1), `require_role` (existing,
  `app/core/security.py`), `IngestionBatch` (existing schema).
- Produces (used by Task 3): `POST /api/v1/batches/{batch_id}/start` → `200` + `IngestionBatch`
  body on success, `404` if unknown id, `409` if invalid transition, `403` if insufficient role.

- [ ] **Step 1: Write the failing test**

Create `portal/services/ingestion-api/tests/api/test_routes_batches.py`:

```python
from app.db.session import _batches, create_batch


def test_start_batch_success(admin_client) -> None:
    batch = create_batch(connector_id="c1", source_uri="gitlab://x", artifact_type="markdown", total=10)

    response = admin_client.post(f"/api/v1/batches/{batch.id}/start")

    assert response.status_code == 200
    assert response.json()["status"] == "processing"


def test_start_batch_unknown_id_returns_404(admin_client) -> None:
    response = admin_client.post("/api/v1/batches/does-not-exist/start")
    assert response.status_code == 404


def test_start_batch_invalid_transition_returns_409(admin_client) -> None:
    batch = create_batch(connector_id="c2", source_uri="gitlab://y", artifact_type="markdown", total=1)
    _batches[batch.id] = batch.model_copy(update={"status": "processing"})

    response = admin_client.post(f"/api/v1/batches/{batch.id}/start")

    assert response.status_code == 409
```

This uses the `admin_client` fixture already defined in
`portal/services/ingestion-api/tests/conftest.py` (from an earlier plan — overrides
`get_current_principal` with `roles=["km-admin"]`). No new fixture needed.

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/Scripts/python.exe -m pytest tests/api/test_routes_batches.py -v`
Expected: FAIL — 404 "Not Found" from FastAPI itself (the route doesn't exist yet), not the
app-level 404 the test expects to see on the second test (both would currently 404 identically
from routing, but the first test expects 200 and will fail).

- [ ] **Step 3: Write the implementation**

Read the current full contents of `portal/services/ingestion-api/app/api/routes_batches.py`
first — it's short (34 lines). Add the import and the new route:

```python
from fastapi import APIRouter, Depends, HTTPException, status

from app.core.security import Principal, require_role
from app.db.session import InvalidBatchTransitionError, create_batch, get_connector, list_batches, start_batch
from app.models.schemas import IngestionBatch, TriggerIngestionRequest

router = APIRouter(prefix="/batches", tags=["batches"])

_READ_ROLES = ("km-admin", "km-curator", "km-operator", "km-auditor")
_TRIGGER_ROLES = ("km-admin", "km-operator")


@router.get("", response_model=list[IngestionBatch])
async def get_batches(_principal: Principal = Depends(require_role(*_READ_ROLES))) -> list[IngestionBatch]:
    return list_batches()


@router.post("", response_model=IngestionBatch, status_code=status.HTTP_201_CREATED)
async def trigger_batch(
    body: TriggerIngestionRequest,
    _principal: Principal = Depends(require_role(*_TRIGGER_ROLES)),
) -> IngestionBatch:
    connector = get_connector(body.connector_id)
    if connector is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conector no encontrado")

    source_uri = ", ".join(body.paths) if body.paths else connector.base_uri
    return create_batch(
        connector_id=connector.id,
        source_uri=source_uri,
        artifact_type="markdown+pdf",
        total=0,
    )


@router.post("/{batch_id}/start", response_model=IngestionBatch)
async def start_batch_route(
    batch_id: str,
    _principal: Principal = Depends(require_role(*_TRIGGER_ROLES)),
) -> IngestionBatch:
    try:
        batch = start_batch(batch_id)
    except InvalidBatchTransitionError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    if batch is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Batch no encontrado")
    return batch
```

This is the full file contents — replace the file entirely with the above (it only adds the
import of `InvalidBatchTransitionError`/`start_batch` and the one new route; everything else is
unchanged from what exists today).

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/Scripts/python.exe -m pytest tests/api/test_routes_batches.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Run the full backend test suite**

Run: `.venv/Scripts/python.exe -m pytest -v`
Expected: all tests pass (no regressions in `routes_connectors.py`, `routes_gitlab.py`, etc. —
this task only touches `routes_batches.py` and adds new test files).

- [ ] **Step 6: Commit**

```bash
git add portal/services/ingestion-api/app/api/routes_batches.py portal/services/ingestion-api/tests/api/test_routes_batches.py
git commit -m "feat(ingestion-api): add POST /batches/{id}/start endpoint"
```

---

### Task 3: BFF proxy route

**Files:**
- Create: `portal/bff/src/app/api/ingesta/batches/[id]/start/route.ts`

**Interfaces:**
- Consumes: `getSession()` (existing, `portal/bff/src/lib/session.ts`), the ingestion-api endpoint
  from Task 2 (`POST /api/v1/batches/{id}/start`).
- Produces (used by Task 4): `POST {BFF}/api/ingesta/batches/{id}/start`.

- [ ] **Step 1: Create the route**

Create `portal/bff/src/app/api/ingesta/batches/[id]/start/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";

const upstream = process.env.INGESTION_API_URL ?? "http://localhost:8001";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  const response = await fetch(`${upstream}/api/v1/batches/${id}/start`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });
  const body = await response.json().catch(() => ({}));
  return NextResponse.json(body, { status: response.status });
}
```

- [ ] **Step 2: Verify the BFF still builds**

Run (from `portal/bff/`): `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add portal/bff/src/app/api/ingesta/batches/
git commit -m "feat(bff): proxy POST /batches/{id}/start to ingestion-api"
```

---

### Task 4: `ingesta-api.service.ts` — `startBatch` method

**Files:**
- Modify: `portal/micro-ui-ingesta/src/app/ingesta-api.service.ts`

**Interfaces:**
- Consumes: the BFF route from Task 3.
- Produces (used by Task 5): `startBatch(id: string): Promise<IngestionBatch | null>`.

- [ ] **Step 1: Add the method**

In `portal/micro-ui-ingesta/src/app/ingesta-api.service.ts`, add immediately after the existing
`listBatches` method (around line 109):

```typescript
  async startBatch(id: string): Promise<IngestionBatch | null> {
    const response = await fetch(`${BFF_BASE_URL}/api/ingesta/batches/${id}/start`, {
      method: "POST",
      credentials: "include",
    });
    if (!response.ok) return null;
    return (await response.json()) as IngestionBatch;
  }
```

- [ ] **Step 2: Verify the Angular workspace compiles**

Run (from `portal/micro-ui-ingesta/`): `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors (only the pre-existing, unrelated `@types/node/*.d.ts` errors from the
environment — ignore those).

- [ ] **Step 3: Commit**

```bash
git add portal/micro-ui-ingesta/src/app/ingesta-api.service.ts
git commit -m "feat(micro-ui-ingesta): add startBatch to ingesta-api.service.ts"
```

---

### Task 5: "Ejecución y monitoreo" page

**Files:**
- Create: `portal/micro-ui-ingesta/src/app/pages/ejecucion/ejecucion.component.ts`
- Modify: `portal/micro-ui-ingesta/src/app/ingesta.routes.ts`

**Interfaces:**
- Consumes: `listBatches`, `startBatch`, `IngestionBatch` (Task 4 + existing).
- Produces: nothing consumed by later tasks (leaf component + one route entry).

- [ ] **Step 1: Create the component**

Create `portal/micro-ui-ingesta/src/app/pages/ejecucion/ejecucion.component.ts`:

```typescript
import { Component, OnInit, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { IngestaApiService, IngestionBatch } from "../../ingesta-api.service";

interface StatusMeta {
  label: string;
  tagClass: string;
}

const STATUS_META: Record<string, StatusMeta> = {
  queued: { label: "En cola", tagClass: "tag tag-neutral" },
  processing: { label: "Procesando", tagClass: "tag tag-outline" },
  indexed: { label: "Indexado", tagClass: "tag tag-accent" },
  draft_created: { label: "Draft creado", tagClass: "tag tag-accent" },
  failed: { label: "Fallido", tagClass: "tag tag-neutral" },
  skipped: { label: "Omitido", tagClass: "tag tag-neutral" },
  stale: { label: "Desactualizado", tagClass: "tag tag-outline" },
};

// Pantalla "Ejecución y monitoreo" del diseño Claude Design: tarjetas de job por batch,
// con transición manual de estado (Iniciar/Reintentar) — sin motor de progreso automático.
@Component({
  selector: "km-ejecucion",
  standalone: true,
  imports: [CommonModule],
  template: `
    <div style="padding:24px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div class="text-muted" style="font-size:13px">{{ queuedCount() }} en cola · {{ processingCount() }} procesando</div>
        <button type="button" class="btn btn-primary" [disabled]="queuedCount() === 0 || bulkStarting()" (click)="startAllQueued()">
          {{ bulkStarting() ? "Ejecutando…" : "Ejecutar pendientes" }}
        </button>
      </div>

      <div class="card" style="padding:14px;margin-bottom:12px" *ngFor="let batch of batches()">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
          <div>
            <div class="card-title" style="font-size:15px">{{ batch.source_uri }}</div>
            <div class="text-muted" style="font-size:12px">{{ batch.connector_id }} · {{ batch.artifact_type }}</div>
          </div>
          <span [class]="statusMeta(batch.status).tagClass">{{ statusMeta(batch.status).label }}</span>
        </div>
        <div style="height:6px;background:var(--color-divider);margin-top:12px;position:relative;overflow:hidden;border-radius:4px">
          <div [style.width.%]="progressPercent(batch)" style="height:100%;background:var(--color-accent)"></div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
          <span class="text-muted" style="font-size:12px">{{ batch.processed }}/{{ batch.total }} documentos</span>
          <button
            type="button"
            class="btn btn-secondary"
            [disabled]="!isActionable(batch.status) || startingIds().has(batch.id)"
            (click)="start(batch)"
          >
            {{ actionLabel(batch) }}
          </button>
        </div>
      </div>
      <div class="text-muted" *ngIf="batches().length === 0">Sin batches registrados todavía.</div>
    </div>
  `,
})
export class EjecucionComponent implements OnInit {
  private readonly api = inject(IngestaApiService);
  protected readonly batches = signal<IngestionBatch[]>([]);
  protected readonly startingIds = signal<Set<string>>(new Set());
  protected readonly bulkStarting = signal(false);

  protected readonly queuedCount = () => this.batches().filter((b) => b.status === "queued").length;
  protected readonly processingCount = () => this.batches().filter((b) => b.status === "processing").length;

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  private async reload(): Promise<void> {
    this.batches.set(await this.api.listBatches());
  }

  protected statusMeta(status: string): StatusMeta {
    return STATUS_META[status] ?? { label: status, tagClass: "tag tag-neutral" };
  }

  protected progressPercent(batch: IngestionBatch): number {
    return batch.total > 0 ? (batch.processed / batch.total) * 100 : 0;
  }

  protected isActionable(status: string): boolean {
    return status === "queued" || status === "failed";
  }

  protected actionLabel(batch: IngestionBatch): string {
    if (batch.status === "queued") return "Iniciar";
    if (batch.status === "failed") return "Reintentar";
    if (batch.status === "processing") return "Procesando…";
    return "Ver detalle";
  }

  protected async start(batch: IngestionBatch): Promise<void> {
    if (!this.isActionable(batch.status)) return;
    this.startingIds.update((current) => new Set(current).add(batch.id));
    try {
      await this.api.startBatch(batch.id);
      await this.reload();
    } finally {
      this.startingIds.update((current) => {
        const next = new Set(current);
        next.delete(batch.id);
        return next;
      });
    }
  }

  protected async startAllQueued(): Promise<void> {
    const queued = this.batches().filter((b) => b.status === "queued");
    if (queued.length === 0) return;
    this.bulkStarting.set(true);
    try {
      await Promise.all(queued.map((b) => this.api.startBatch(b.id)));
      await this.reload();
    } finally {
      this.bulkStarting.set(false);
    }
  }
}
```

- [ ] **Step 2: Add the route**

In `portal/micro-ui-ingesta/src/app/ingesta.routes.ts`, add a new entry after the `vault` route:

```typescript
  {
    path: "ejecucion",
    loadComponent: () => import("./pages/ejecucion/ejecucion.component").then((m) => m.EjecucionComponent),
  },
```

- [ ] **Step 3: Verify the Angular workspace compiles**

Run (from `portal/micro-ui-ingesta/`): `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors (only the pre-existing `@types/node` environment errors).

- [ ] **Step 4: Manual verification**

With the full dev stack running (shell, micro-ui-ingesta, BFF, ingestion-api), navigate to
`/ingesta/ejecucion`:
1. If no batches exist yet, create one via an existing flow (e.g. `POST /batches` from wherever
   it's already wired — check `conectores.component.ts` or trigger manually via the BFF route) and
   confirm it appears here as "En cola".
2. Click "Iniciar" on a queued batch — confirm it flips to "Procesando" and the button becomes
   disabled with the label "Procesando…".
3. Manually flip a batch's status to `failed` in `db/session.py`'s in-memory store (or via a
   future flow, once one exists) and confirm "Reintentar" is offered and works the same way.
4. With more than one batch queued, click "Ejecutar pendientes" and confirm all queued batches
   flip to processing.

- [ ] **Step 5: Commit**

```bash
git add portal/micro-ui-ingesta/src/app/pages/ejecucion/ portal/micro-ui-ingesta/src/app/ingesta.routes.ts
git commit -m "feat(micro-ui-ingesta): add Ejecución y monitoreo screen"
```

---

### Task 6: Shell sidebar nav link

**Files:**
- Modify: `portal/shell/src/app/app.component.ts`

**Interfaces:**
- Consumes: nothing new (a static `routerLink`).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the nav link**

In `portal/shell/src/app/app.component.ts`, the `<nav>` block inside `<aside>` currently has:

```html
            <a routerLink="/ingesta/conectores" routerLinkActive="nav-active" class="nav-item">Conectores y fuentes</a>
            <a routerLink="/ingesta/vault" routerLinkActive="nav-active" class="nav-item">Credenciales (Vault)</a>
```

Insert the new link between them, matching the mock's `NAV_DEF` ordering
(`conectoresFuentes` → `ejecucion` → ... → `vault`):

```html
            <a routerLink="/ingesta/conectores" routerLinkActive="nav-active" class="nav-item">Conectores y fuentes</a>
            <a routerLink="/ingesta/ejecucion" routerLinkActive="nav-active" class="nav-item">Ejecución y monitoreo</a>
            <a routerLink="/ingesta/vault" routerLinkActive="nav-active" class="nav-item">Credenciales (Vault)</a>
```

- [ ] **Step 2: Verify the Shell workspace compiles**

Run (from `portal/shell/`): `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors (only the pre-existing `@types/node` environment errors).

- [ ] **Step 3: Manual verification**

With the dev stack running, confirm the sidebar shows "Ejecución y monitoreo" between "Conectores
y fuentes" and "Credenciales (Vault)", and that clicking it navigates to the page built in Task 5.

- [ ] **Step 4: Commit**

```bash
git add portal/shell/src/app/app.component.ts
git commit -m "feat(shell): add Ejecución y monitoreo nav link"
```

---

## Final Verification (after all tasks)

- [ ] Run the full ingestion-api test suite: `.venv/Scripts/python.exe -m pytest -v` (from
  `portal/services/ingestion-api/`) — all tests pass.
- [ ] Run `npx tsc --noEmit -p tsconfig.json` from `portal/micro-ui-ingesta/`, `portal/shell/`,
  and `npx tsc --noEmit` from `portal/bff/` — no new errors anywhere.
- [ ] With the full stack running, walk the end-to-end flow once more: a queued batch appears in
  "Ejecución y monitoreo", "Iniciar" flips it to processing, "Ejecutar pendientes" starts every
  queued batch at once, and the sidebar nav link works from a fresh page load.
