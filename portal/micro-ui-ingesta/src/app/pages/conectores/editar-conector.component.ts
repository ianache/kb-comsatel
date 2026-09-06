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
