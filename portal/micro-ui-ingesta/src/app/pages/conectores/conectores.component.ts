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
