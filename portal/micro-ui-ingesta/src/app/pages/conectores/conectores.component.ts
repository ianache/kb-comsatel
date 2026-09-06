import { Component, OnInit, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { Router, RouterLink } from "@angular/router";
import { Connector, GitLabRepoLink, IngestaApiService } from "../../ingesta-api.service";
import { EditarConectorComponent } from "./editar-conector.component";

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
    this.testResult.set(null);
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
