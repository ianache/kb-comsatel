import { Component, EventEmitter, Input, Output, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { Connector, IngestaApiService } from "../../ingesta-api.service";
import { inject } from "@angular/core";

// Panel lateral "Configurar" — edita nombre/base_uri/vault_secret_ref/active de un
// conector existente. Reutilizable por los 4 tipos de conector. Para GitLab, además
// incorpora "Ingesta manual" (Forzar ingesta ahora) y el modo de sincronización
// (CRON / Webhook) — solo como configuración; no hay scheduler ni receptor webhook
// reales todavía.
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

        <ng-container *ngIf="connector.kind === 'gitlab'">
          <div class="card" style="padding:14px;margin-top:16px">
            <div class="card-kicker" style="margin-bottom:8px">Ingesta manual</div>
            <p class="card-body" style="margin-bottom:10px">
              Dispara una ejecución de ingesta inmediata sobre los repositorios vinculados de este conector, sin esperar al ciclo de sincronización.
            </p>
            <button type="button" class="btn btn-primary" (click)="forceIngest()" [disabled]="forcingIngest()">
              {{ forcingIngest() ? "Encolando…" : "Forzar ingesta ahora" }}
            </button>
            <div class="text-muted" style="font-size:12px;margin-top:8px" *ngIf="forceResult()">{{ forceResult() }}</div>
          </div>

          <div class="field" style="margin-top:16px">
            <label>Modo de sincronización</label>
            <div class="seg" style="width:100%">
              <label
                class="seg-opt"
                [style.background]="form.sync_mode === 'cron' ? 'var(--color-accent)' : 'transparent'"
                [style.color]="form.sync_mode === 'cron' ? '#fff' : 'var(--color-neutral-700)'"
                (click)="form.sync_mode = 'cron'"
                >CRON</label
              >
              <label
                class="seg-opt"
                [style.background]="form.sync_mode === 'webhook' ? 'var(--color-accent)' : 'transparent'"
                [style.color]="form.sync_mode === 'webhook' ? '#fff' : 'var(--color-neutral-700)'"
                (click)="form.sync_mode = 'webhook'"
                >Webhook</label
              >
            </div>
          </div>

          <div class="field" style="margin-top:12px" *ngIf="form.sync_mode === 'cron'">
            <label>Expresión CRON</label>
            <input class="input" style="font-family:ui-monospace,Menlo,monospace" placeholder="*/30 * * * *" [(ngModel)]="form.cron_expr" name="cron_expr" />
            <div class="text-muted" style="font-size:11px">Ejemplo: */30 * * * * — cada 30 minutos.</div>
          </div>

          <ng-container *ngIf="form.sync_mode === 'webhook'">
            <div class="field" style="margin-top:12px">
              <label>URL de recepción del webhook</label>
              <input class="input" style="font-family:ui-monospace,Menlo,monospace" readonly [value]="webhookUrl()" />
            </div>
            <div class="field" style="margin-top:12px">
              <label>Secreto de verificación (Vault)</label>
              <input class="input" [(ngModel)]="form.webhook_secret_ref" name="webhook_secret_ref" />
              <div class="text-muted" style="font-size:11px">GitLab firma cada payload con HMAC usando este secreto; se valida antes de encolar la ingesta.</div>
            </div>
          </ng-container>
        </ng-container>

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

  protected form = {
    name: "",
    base_uri: "",
    vault_secret_ref: "",
    active: true,
    sync_mode: "cron" as "cron" | "webhook",
    cron_expr: "",
    webhook_secret_ref: "",
  };
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly forcingIngest = signal(false);
  protected readonly forceResult = signal<string | null>(null);

  ngOnChanges(): void {
    this.form = {
      name: this.connector.name,
      base_uri: this.connector.base_uri,
      vault_secret_ref: this.connector.vault_secret_ref,
      active: this.connector.active,
      sync_mode: this.connector.sync_mode ?? "cron",
      cron_expr: this.connector.cron_expr ?? "*/30 * * * *",
      webhook_secret_ref: this.connector.webhook_secret_ref ?? "",
    };
    this.forceResult.set(null);
  }

  protected webhookUrl(): string {
    return `https://ingesta-api.comsatel.internal/webhooks/gitlab/${this.connector.id}`;
  }

  protected async forceIngest(): Promise<void> {
    this.forcingIngest.set(true);
    this.forceResult.set("Encolando ingesta manual…");
    try {
      const result = await this.api.forceIngest(this.connector.id);
      if (result.ok) {
        this.forceResult.set(`✓ Ingesta encolada para ${result.count} repositorio(s) vinculado(s).`);
      } else {
        this.forceResult.set(`✗ ${result.error ?? "No se pudo encolar la ingesta."}`);
      }
    } finally {
      this.forcingIngest.set(false);
    }
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
