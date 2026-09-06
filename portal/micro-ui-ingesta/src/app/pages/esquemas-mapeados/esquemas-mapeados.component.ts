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
