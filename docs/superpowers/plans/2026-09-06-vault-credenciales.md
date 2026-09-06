# Integración HashiCorp Vault — Credenciales — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrar HashiCorp Vault (KV v2) en `ingestion-api`, exponerlo vía BFF, y agregar la pantalla "Credenciales (Vault)" (nav + página) al portal.

**Architecture:** Mismo patrón ya establecido: cliente HTTP delgado en el backend Python → proxy BFF con bearer forwarding → componente Angular standalone. El token de Vault vive solo en `ingestion-api`, nunca cruza al BFF ni al browser.

**Tech Stack:** `httpx` (ya es dependencia de `ingestion-api`) para llamar la API REST de Vault. Next.js route handlers. Angular 18 standalone + signals.

**Spec:** `docs/superpowers/specs/2026-09-06-vault-credenciales-design.md`

## Global Constraints

- Nunca se devuelve el valor de un secreto al frontend — ni en lectura ni tras escritura, solo metadata (path, versión, fecha).
- Todos los endpoints Vault requieren rol `km-admin`.
- Sin `KM_VAULT_TOKEN` configurado, los endpoints devuelven `503` con mensaje claro, no `500` ni excepción sin manejar.
- `{path}` es un segmento simple sin `/` anidados (fuera de alcance subpaths anidados).
- Config vía env: `KM_VAULT_ADDR` (default `http://192.168.100.205:8200`), `KM_VAULT_TOKEN` (sin default), `KM_VAULT_KV_PATH` (default `secrets/kb`).

---

## Task 1: Cliente Vault y endpoints (backend)

**Files:**
- Create: `portal/services/ingestion-api/app/core/vault_client.py`
- Create: `portal/services/ingestion-api/app/api/routes_vault.py`
- Modify: `portal/services/ingestion-api/app/core/config.py`
- Modify: `portal/services/ingestion-api/app/main.py`

**Interfaces:**
- Produces: `VaultNotConfiguredError`, `VaultClient` (métodos `list_secrets`, `get_secret_metadata`, `write_secret`, `delete_secret`), router Vault montado en `/api/v1/vault`.

- [ ] **Step 1: Agregar settings de Vault a `config.py`**

Agregar estos campos a la clase `Settings` (junto a los ya existentes de Keycloak):

```python
    vault_addr: str = "http://192.168.100.205:8200"
    vault_token: str = ""
    vault_kv_path: str = "secrets/kb"
```

- [ ] **Step 2: Crear `vault_client.py`**

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
        self._kv_path = settings.vault_kv_path.strip("/")
        self._headers = {"X-Vault-Token": settings.vault_token}

    async def list_secrets(self) -> list[str]:
        url = f"{self._addr}/v1/{self._kv_path}/metadata"
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.request("LIST", url, headers=self._headers)
        if response.status_code == 404:
            return []
        response.raise_for_status()
        return response.json()["data"]["keys"]

    async def get_secret_metadata(self, path: str) -> dict:
        url = f"{self._addr}/v1/{self._kv_path}/metadata/{path}"
        async with httpx.AsyncClient(timeout=10.0) as client:
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

    async def write_secret(self, path: str, data: dict[str, str]) -> None:
        url = f"{self._addr}/v1/{self._kv_path}/data/{path}"
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(url, headers=self._headers, json={"data": data})
        response.raise_for_status()

    async def delete_secret(self, path: str) -> None:
        url = f"{self._addr}/v1/{self._kv_path}/metadata/{path}"
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.delete(url, headers=self._headers)
        if response.status_code not in (204, 404):
            response.raise_for_status()
```

- [ ] **Step 3: Crear `routes_vault.py`**

```python
from fastapi import APIRouter, Body, Depends, HTTPException, status

from app.core.config import Settings, get_settings
from app.core.security import Principal, require_role
from app.core.vault_client import VaultClient, VaultNotConfiguredError

router = APIRouter(prefix="/vault", tags=["vault"])

_WRITE_ROLES = ("km-admin",)


def _get_client(settings: Settings = Depends(get_settings)) -> VaultClient:
    try:
        return VaultClient(settings)
    except VaultNotConfiguredError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc


def _vault_error(exc: Exception) -> HTTPException:
    return HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=f"Vault no disponible: {exc}")


@router.get("/secrets")
async def list_secrets(
    _principal: Principal = Depends(require_role(*_WRITE_ROLES)),
    client: VaultClient = Depends(_get_client),
) -> list[str]:
    try:
        return await client.list_secrets()
    except Exception as exc:  # httpx/network errors — surface as 503, never 500
        raise _vault_error(exc) from exc


@router.get("/secrets/{path}/metadata")
async def get_secret_metadata(
    path: str,
    _principal: Principal = Depends(require_role(*_WRITE_ROLES)),
    client: VaultClient = Depends(_get_client),
) -> dict:
    try:
        return await client.get_secret_metadata(path)
    except Exception as exc:
        raise _vault_error(exc) from exc


@router.put("/secrets/{path}", status_code=status.HTTP_204_NO_CONTENT)
async def write_secret(
    path: str,
    data: dict[str, str] = Body(...),
    _principal: Principal = Depends(require_role(*_WRITE_ROLES)),
    client: VaultClient = Depends(_get_client),
) -> None:
    try:
        await client.write_secret(path, data)
    except Exception as exc:
        raise _vault_error(exc) from exc


@router.delete("/secrets/{path}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_secret(
    path: str,
    _principal: Principal = Depends(require_role(*_WRITE_ROLES)),
    client: VaultClient = Depends(_get_client),
) -> None:
    try:
        await client.delete_secret(path)
    except Exception as exc:
        raise _vault_error(exc) from exc
```

- [ ] **Step 4: Registrar el router en `main.py`**

Agregar el import junto a los demás routers y una línea `app.include_router(vault_router, prefix="/api/v1")` junto a las otras `include_router`:

```python
from app.api.routes_vault import router as vault_router
```

- [ ] **Step 5: Verificar**

```bash
cd portal/services/ingestion-api && ./.venv/Scripts/python.exe -c "import app.main"
```

Expected: sin excepción. Luego, con el servidor corriendo:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8001/api/v1/vault/secrets
```

Expected: `401` (sin token) — confirma que la ruta existe.

- [ ] **Step 6: Commit**

```bash
git add portal/services/ingestion-api/app/core/vault_client.py portal/services/ingestion-api/app/api/routes_vault.py portal/services/ingestion-api/app/core/config.py portal/services/ingestion-api/app/main.py
git commit -m "feat(ingestion-api): add HashiCorp Vault KV v2 client and endpoints"
```

---

## Task 2: Rutas proxy BFF

**Files:**
- Create: `portal/bff/src/app/api/ingesta/vault/secrets/route.ts`
- Create: `portal/bff/src/app/api/ingesta/vault/secrets/[path]/route.ts`
- Create: `portal/bff/src/app/api/ingesta/vault/secrets/[path]/metadata/route.ts`

**Interfaces:**
- Consumes: `getSession()` de `@/lib/session` (ya existente).

- [ ] **Step 1: `vault/secrets/route.ts` (GET — lista paths)**

```typescript
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export async function GET(): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const upstream = process.env.INGESTION_API_URL ?? "http://localhost:8001";
  const response = await fetch(`${upstream}/api/v1/vault/secrets`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  return NextResponse.json(body, { status: response.status });
}
```

- [ ] **Step 2: `vault/secrets/[path]/route.ts` (PUT + DELETE)**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";

const upstream = process.env.INGESTION_API_URL ?? "http://localhost:8001";

export async function PUT(request: NextRequest, { params }: { params: Promise<{ path: string }> }): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { path } = await params;
  const payload = await request.json();
  const response = await fetch(`${upstream}/api/v1/vault/secrets/${path}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (response.status === 204) return new NextResponse(null, { status: 204 });
  const body = await response.json().catch(() => ({}));
  return NextResponse.json(body, { status: response.status });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ path: string }> }): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { path } = await params;
  const response = await fetch(`${upstream}/api/v1/vault/secrets/${path}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });
  if (response.status === 204) return new NextResponse(null, { status: 204 });
  const body = await response.json().catch(() => ({}));
  return NextResponse.json(body, { status: response.status });
}
```

- [ ] **Step 3: `vault/secrets/[path]/metadata/route.ts` (GET)**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ path: string }> }): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { path } = await params;
  const upstream = process.env.INGESTION_API_URL ?? "http://localhost:8001";
  const response = await fetch(`${upstream}/api/v1/vault/secrets/${path}/metadata`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  return NextResponse.json(body, { status: response.status });
}
```

- [ ] **Step 4: Verificar**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/ingesta/vault/secrets
```

Expected: `401` (sin sesión).

- [ ] **Step 5: Commit**

```bash
git add portal/bff/src/app/api/ingesta/vault
git commit -m "feat(bff): proxy routes for Vault credentials"
```

---

## Task 3: Nav item, ruta y pantalla "Credenciales (Vault)"

**Files:**
- Modify: `portal/shell/src/app/app.component.ts`
- Modify: `portal/micro-ui-ingesta/src/app/ingesta-api.service.ts`
- Create: `portal/micro-ui-ingesta/src/app/pages/vault-credenciales/vault-credenciales.component.ts`
- Modify: `portal/micro-ui-ingesta/src/app/ingesta.routes.ts`

**Interfaces:**
- Produces: `IngestaApiService.listVaultSecrets()`, `.getVaultSecretMetadata(path)`, `.writeVaultSecret(path, data)`, `.deleteVaultSecret(path)`.

- [ ] **Step 1: Agregar el nav item en `app.component.ts`**

Buscar el bloque `<nav>` con los `<a routerLink="/ingesta/conectores">` y agregar, después de
esa línea:

```html
            <a routerLink="/ingesta/vault" routerLinkActive="nav-active" class="nav-item">Credenciales (Vault)</a>
```

- [ ] **Step 2: Agregar métodos al servicio Angular**

Agregar a `ingesta-api.service.ts`:

```typescript
export interface VaultSecretMetadata {
  path: string;
  current_version: number | null;
  updated_time: string | null;
}
```

Dentro de `IngestaApiService`:

```typescript
  async listVaultSecrets(): Promise<{ paths: string[] } | { error: string }> {
    const response = await fetch(`${BFF_BASE_URL}/api/ingesta/vault/secrets`, { credentials: "include" });
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const detail = body && typeof body === "object" && "detail" in body && typeof body.detail === "string" ? body.detail : `HTTP ${response.status}`;
      return { error: detail };
    }
    return { paths: (await response.json()) as string[] };
  }

  async getVaultSecretMetadata(path: string): Promise<VaultSecretMetadata | null> {
    const response = await fetch(`${BFF_BASE_URL}/api/ingesta/vault/secrets/${path}/metadata`, { credentials: "include" });
    if (!response.ok) return null;
    return (await response.json()) as VaultSecretMetadata;
  }

  async writeVaultSecret(path: string, data: Record<string, string>): Promise<{ ok: boolean; error?: string }> {
    const response = await fetch(`${BFF_BASE_URL}/api/ingesta/vault/secrets/${path}`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (response.ok) return { ok: true };
    const body: unknown = await response.json().catch(() => null);
    const detail = body && typeof body === "object" && "detail" in body && typeof body.detail === "string" ? body.detail : `HTTP ${response.status}`;
    return { ok: false, error: detail };
  }

  async deleteVaultSecret(path: string): Promise<boolean> {
    const response = await fetch(`${BFF_BASE_URL}/api/ingesta/vault/secrets/${path}`, {
      method: "DELETE",
      credentials: "include",
    });
    return response.ok;
  }
```

- [ ] **Step 3: Agregar la ruta**

En `ingesta.routes.ts`:

```typescript
  {
    path: "vault",
    loadComponent: () => import("./pages/vault-credenciales/vault-credenciales.component").then((m) => m.VaultCredencialesComponent),
  },
```

- [ ] **Step 4: Crear el componente**

```typescript
import { Component, OnInit, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { IngestaApiService, VaultSecretMetadata } from "../../ingesta-api.service";

interface KeyValueRow {
  key: string;
  value: string;
}

// Pantalla "Credenciales (Vault)": lista paths bajo secrets/kb/ (solo metadata — nunca el
// valor), permite crear/sobrescribir y eliminar. Al editar un path existente los campos de
// valor empiezan vacíos; guardar sobrescribe todas las claves enviadas (FR-01 / Sec.7:
// el valor nunca se muestra en la interfaz).
@Component({
  selector: "km-vault-credenciales",
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div style="padding:24px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;margin-bottom:20px">
        <div>
          <h2 style="margin:0">Credenciales (Vault)</h2>
          <div class="text-muted" style="font-size:13px">Referencias en HashiCorp Vault bajo secrets/kb — nunca se expone el valor</div>
        </div>
        <button type="button" class="btn btn-primary" style="white-space:nowrap" (click)="openDialog()">+ Nueva credencial</button>
      </div>

      <div class="card" style="padding:14px 16px;margin-bottom:16px" *ngIf="loadError()">
        <span class="tag tag-neutral">{{ loadError() }}</span>
      </div>

      <table class="table" *ngIf="!loadError()">
        <thead><tr><th>Path</th><th>Versión</th><th>Última modificación</th><th></th></tr></thead>
        <tbody>
          <tr *ngFor="let path of paths()">
            <td style="font-family:ui-monospace,Menlo,monospace">{{ path }}</td>
            <td>{{ metadataByPath()[path]?.current_version ?? "—" }}</td>
            <td class="text-muted">{{ metadataByPath()[path]?.updated_time ?? "—" }}</td>
            <td style="text-align:right">
              <button type="button" class="btn btn-secondary" (click)="openDialog(path)">Editar</button>
              <button type="button" class="btn btn-ghost" (click)="remove(path)">Eliminar</button>
            </td>
          </tr>
          <tr *ngIf="paths().length === 0">
            <td colspan="4" class="text-muted">Sin credenciales registradas todavía.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div *ngIf="dialogOpen()" style="position:fixed;inset:0;background:rgba(15,23,42,0.45);z-index:50;display:flex;justify-content:flex-end" (click)="closeDialog()">
      <div style="background:var(--color-bg);width:440px;max-width:100%;height:100%;box-shadow:var(--shadow-lg);display:flex;flex-direction:column" (click)="$event.stopPropagation()">
        <div style="padding:20px 24px;border-bottom:1px solid var(--color-divider)">
          <h4 style="margin:0">{{ editingPath() ? "Editar credencial" : "Nueva credencial" }}</h4>
          <div class="text-muted" style="font-size:12px;margin-top:2px">Los valores nunca se precargan — se sobrescriben al guardar</div>
        </div>
        <div style="flex:1;overflow-y:auto;padding:24px;display:flex;flex-direction:column;gap:16px">
          <div class="field">
            <label>Path (bajo secrets/kb/)</label>
            <input class="input" [(ngModel)]="pathInput" name="pathInput" [disabled]="!!editingPath()" placeholder="gitlab" />
          </div>
          <div class="field" *ngFor="let row of rows(); let i = index">
            <label>Clave / valor {{ i + 1 }}</label>
            <div style="display:flex;gap:8px">
              <input class="input" [(ngModel)]="row.key" [name]="'key' + i" placeholder="token" />
              <input class="input" [(ngModel)]="row.value" [name]="'value' + i" type="password" placeholder="valor" />
              <button type="button" class="btn btn-ghost btn-icon" (click)="removeRow(i)">✕</button>
            </div>
          </div>
          <button type="button" class="btn btn-secondary" style="align-self:flex-start" (click)="addRow()">+ Agregar par clave/valor</button>
          <div class="text-muted" style="font-size:12px" *ngIf="dialogError()">{{ dialogError() }}</div>
        </div>
        <div style="padding:16px 24px;border-top:1px solid var(--color-divider);display:flex;justify-content:flex-end;gap:10px">
          <button type="button" class="btn btn-secondary" (click)="closeDialog()" [disabled]="saving()">Cancelar</button>
          <button type="button" class="btn btn-primary" [disabled]="saving() || !canSave()" (click)="save()">
            {{ saving() ? "Guardando…" : "Guardar" }}
          </button>
        </div>
      </div>
    </div>
  `,
})
export class VaultCredencialesComponent implements OnInit {
  private readonly api = inject(IngestaApiService);

  protected readonly paths = signal<string[]>([]);
  protected readonly metadataByPath = signal<Record<string, VaultSecretMetadata>>({});
  protected readonly loadError = signal<string | null>(null);

  protected readonly dialogOpen = signal(false);
  protected readonly editingPath = signal<string | null>(null);
  protected pathInput = "";
  protected readonly rows = signal<KeyValueRow[]>([{ key: "", value: "" }]);
  protected readonly saving = signal(false);
  protected readonly dialogError = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  private async reload(): Promise<void> {
    const result = await this.api.listVaultSecrets();
    if ("error" in result) {
      this.loadError.set(result.error);
      return;
    }
    this.loadError.set(null);
    this.paths.set(result.paths);
    const metadata: Record<string, VaultSecretMetadata> = {};
    for (const path of result.paths) {
      const meta = await this.api.getVaultSecretMetadata(path);
      if (meta) metadata[path] = meta;
    }
    this.metadataByPath.set(metadata);
  }

  protected openDialog(path?: string): void {
    this.editingPath.set(path ?? null);
    this.pathInput = path ?? "";
    this.rows.set([{ key: "", value: "" }]);
    this.dialogError.set(null);
    this.dialogOpen.set(true);
  }

  protected closeDialog(): void {
    if (this.saving()) return;
    this.dialogOpen.set(false);
  }

  protected addRow(): void {
    this.rows.update((rows) => [...rows, { key: "", value: "" }]);
  }

  protected removeRow(index: number): void {
    this.rows.update((rows) => rows.filter((_, i) => i !== index));
  }

  protected canSave(): boolean {
    return this.pathInput.trim().length > 0 && this.rows().some((row) => row.key.trim().length > 0);
  }

  protected async save(): Promise<void> {
    if (!this.canSave()) return;
    this.saving.set(true);
    this.dialogError.set(null);
    try {
      const data: Record<string, string> = {};
      for (const row of this.rows()) {
        if (row.key.trim()) data[row.key.trim()] = row.value;
      }
      const result = await this.api.writeVaultSecret(this.pathInput.trim(), data);
      if (!result.ok) {
        this.dialogError.set(result.error ?? "No se pudo guardar la credencial.");
        return;
      }
      this.dialogOpen.set(false);
      await this.reload();
    } catch {
      this.dialogError.set("Error de red o del servidor al guardar la credencial.");
    } finally {
      this.saving.set(false);
    }
  }

  protected async remove(path: string): Promise<void> {
    if (!confirm(`¿Eliminar la credencial "${path}"? Esta acción no se puede deshacer.`)) return;
    const ok = await this.api.deleteVaultSecret(path);
    if (ok) await this.reload();
  }
}
```

- [ ] **Step 5: Verificar compilación**

```bash
cd portal/micro-ui-ingesta && npx tsc --noEmit -p tsconfig.app.json
```

Expected: sin errores nuevos.

- [ ] **Step 6: Verificación manual**

Con sesión `km-admin` autenticada, navegar a `/ingesta/vault`. Si `KM_VAULT_TOKEN` no está
configurado en `ingestion-api`, la pantalla debe mostrar el mensaje de error (no una tabla
vacía silenciosa) — confirmar esto explícitamente, ya que es el estado esperado en este
entorno sin servidor Vault real accesible.

- [ ] **Step 7: Commit**

```bash
git add portal/shell/src/app/app.component.ts portal/micro-ui-ingesta/src/app/ingesta-api.service.ts portal/micro-ui-ingesta/src/app/pages/vault-credenciales portal/micro-ui-ingesta/src/app/ingesta.routes.ts
git commit -m "feat(micro-ui-ingesta): add Credenciales (Vault) screen and nav item"
```

---

## Self-Review Notes

- **Cobertura de spec:** Task 1 cubre cliente + endpoints backend; Task 2 el proxy BFF;
  Task 3 nav + ruta + pantalla. Los 3 puntos del alcance de la spec están cubiertos.
- **Sin exposición de valores:** ningún endpoint ni método del servicio Angular devuelve el
  valor de un secreto — `get_secret_metadata`/`getVaultSecretMetadata` solo devuelven
  path/versión/fecha, confirmado en el código de Task 1 y Task 3.
- **503 explícito:** `_get_client` y cada endpoint en `routes_vault.py` capturan
  `VaultNotConfiguredError` y errores de red, devolviendo 503 en vez de 500 sin manejar.
