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
