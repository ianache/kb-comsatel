# Ejecución y monitoreo — Design Spec

**Date:** 2026-09-06
**Status:** Approved for planning

## Problem

The "Portal KM Comsatel" Claude Design mockup defines a dedicated "Ejecución y monitoreo" screen
(nav item `ejecucion`, roles `admin`/`operador`): a queue-oriented view of ingestion batches, with
per-job action buttons (Iniciar / Reintentar / Ver detalle) and a bulk "Ejecutar pendientes"
action. This screen does not exist in the portal yet. The existing `dashboard/` page
(`showOperacional` in the mock) is a *different* screen — a read-only stat-card + batches table
view — and stays as-is; "Ejecución y monitoreo" is additive, not a replacement.

The backend already has the data model for this (`IngestionBatch`, `BatchStatus`,
`GET/POST /batches`), but no real ingestion engine exists to advance `processed`/`total` or
transition a batch through its lifecycle automatically — that is a separate, much larger system
not built yet. This spec scopes the screen to manual state transitions only, so it ships useful
functionality today without pretending to be a real job runner.

## Goals

- A new screen listing ingestion batches as actionable job cards (source, connector/type, status
  tag, progress bar, contextual action button).
- Manual "Iniciar" (queued → processing) and "Reintentar" (failed → processing) actions, both via
  one backend endpoint.
- A bulk "Ejecutar pendientes" action that starts every currently-queued batch.
- Faithful visual match to the mock's job-card layout and status vocabulary.

## Non-goals

- No real document-processing engine (no automatic progress advancement, no automatic transition
  to `indexed`/`draft_created`/`failed`).
- No batch-detail view — the mock's "Ver detalle" button (shown for `indexed`, `draft_created`,
  `skipped`, `stale`) renders disabled, doing nothing, per explicit decision.
- No changes to how batches are *created* (`POST /batches` stays as today — out of scope; batch
  creation belongs to the mock's separate "Selección de fuentes" screen, not built yet).
- No role-based hiding of the new nav item in the shell — consistent with the rest of the portal,
  authorization is enforced server-side; the frontend does not gate visibility by role.

## Architecture

### Backend: `portal/services/ingestion-api/`

**New endpoint** in `app/api/routes_batches.py`:

```python
@router.post("/{batch_id}/start", response_model=IngestionBatch)
async def start_batch_route(
    batch_id: str,
    _principal: Principal = Depends(require_role(*_TRIGGER_ROLES)),
) -> IngestionBatch:
    batch = start_batch(batch_id)
    if batch is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Batch no encontrado")
    if batch is INVALID_TRANSITION:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="El batch no está en un estado que permita iniciarlo")
    return batch
```

(Exact sentinel/return-shape mechanics are decided in the plan — the important contract is: 404 if
the batch doesn't exist, 409 if its current status isn't `queued` or `failed`, 200 + updated batch
otherwise.) Gated to `_TRIGGER_ROLES = ("km-admin", "km-operador")` — the same set already used by
`POST /batches`.

**New store function** in `app/db/session.py`:

```python
def start_batch(batch_id: str) -> IngestionBatch | None:
    """Transitions an existing batch to `processing`. Returns None if the batch doesn't exist;
    raises InvalidBatchTransitionError if its current status isn't `queued` or `failed`."""
```

Updates `status` to `BatchStatus.processing` and refreshes `updated_at`. No other field changes —
`processed`/`total` are untouched (no progress simulation, per the approved scope decision).

### BFF: `portal/bff/src/app/api/ingesta/batches/[id]/start/route.ts`

Same proxy pattern as every other `ingesta/*` route: `getSession()` → 401 if none, forward
`POST {INGESTION_API_URL}/api/v1/batches/{id}/start` with `Authorization: Bearer <token>`, pass
through the upstream status and body.

### Frontend: `portal/micro-ui-ingesta/`

**New page** `pages/ejecucion/ejecucion.component.ts`, routed at `/ingesta/ejecucion`
(`ingesta.routes.ts` gains one entry).

- Header row: `"{{queuedCount}} en cola · {{processingCount}} procesando"` (computed from the
  fetched batch list) + button "Ejecutar pendientes" (disabled when `queuedCount === 0`).
- One card per batch, in list order returned by the API:
  - Title: `connector_id` (source label — the mock uses a friendlier "fuente" string, but our
    `IngestionBatch` only carries `connector_id`/`source_uri`; use `source_uri` as the card title
    and `connector_id` as the muted subtitle, matching the *data available*, not the mock's exact
    mock-data field names).
  - Status tag, mapped from `BatchStatus` to a label + tag CSS class (mirrors the existing
    `dashboard.component.ts`'s informal status grouping, extended to per-status labels):
    | `BatchStatus` | Label | Tag class |
    |---|---|---|
    | `queued` | En cola | `tag tag-neutral` |
    | `processing` | Procesando | `tag tag-outline` |
    | `indexed` | Indexado | `tag tag-accent` |
    | `draft_created` | Draft creado | `tag tag-accent` |
    | `failed` | Fallido | `tag tag-neutral` |
    | `skipped` | Omitido | `tag tag-neutral` |
    | `stale` | Desactualizado | `tag tag-outline` |
  - Progress bar: `width: (processed/total || 0) * 100%` (guard divide-by-zero when `total === 0`).
  - `"{{processed}}/{{total}} documentos"`.
  - Action button, by status:
    | `BatchStatus` | Button label | Enabled? | Action |
    |---|---|---|---|
    | `queued` | Iniciar | yes | `POST /batches/{id}/start` |
    | `failed` | Reintentar | yes | `POST /batches/{id}/start` |
    | `processing` | Procesando… | no | — |
    | `indexed`, `draft_created`, `skipped`, `stale` | Ver detalle | no | — |

**`ingesta-api.service.ts`** gains `startBatch(id: string): Promise<IngestionBatch | null>` (POST,
returns the updated batch on 200, `null` on any non-2xx — mirrors the existing defensive pattern
used by `linkGitlabRepos` etc.).

**Shell** (`app.component.ts`): new nav link "Ejecución y monitoreo" → `/ingesta/ejecucion`,
inserted after "Conectores y fuentes" and before "Credenciales (Vault)" in the sidebar, matching
the mock's `NAV_DEF` ordering (`conectoresFuentes` → `ejecucion` → ... → `vault`).

### Error handling

- `POST /batches/{id}/start` on an unknown id → 404, surfaced as an inline error (toast or banner,
  implementer's choice consistent with existing patterns) rather than silently failing.
- `POST /batches/{id}/start` on a batch not in `queued`/`failed` → 409 — this shouldn't normally
  be reachable from the UI (buttons are disabled for other states), but the backend enforces it
  regardless of what the frontend sends.
- "Ejecutar pendientes" calls `/start` once per currently-queued batch; if one call fails, the
  others still proceed (independent requests, not a single transaction) — reload the batch list
  after all settle.

### Testing

- Backend: `pytest` tests for `start_batch` (queued→processing succeeds, failed→processing
  succeeds, processing→processing rejected, unknown id returns None) and for the route (403 for
  an insufficient role, 404, 409, 200 with the updated batch).
- Frontend: no component test harness exists elsewhere in this portal (established pattern) —
  manual verification via the running dev stack: create a batch (existing `POST /batches` flow,
  e.g. from a connector), confirm it appears in "Ejecución y monitoreo" as `queued`, click
  "Iniciar", confirm it flips to `processing` and the button disables, confirm "Ejecutar
  pendientes" starts all queued batches at once.

## Open questions

None — all decisions confirmed during brainstorming.
