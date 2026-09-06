import { Component, OnInit, inject, signal, computed } from "@angular/core";
import { CommonModule } from "@angular/common";
import { IngestaApiService, IngestionBatch } from "../../ingesta-api.service";

// Layout follows the "showOperacional" dashboard section of the Portal KM Comsatel
// Claude Design mockup: a topbar title, a row of stat cards, then a batches table.
@Component({
  selector: "km-dashboard",
  standalone: true,
  imports: [CommonModule],
  template: `
    <div style="padding:24px">
      <div>
        <h2 style="margin:0">Panel operacional de ingesta</h2>
        <div class="text-muted" style="font-size:13px">Batches de ingesta en curso e historial reciente</div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin:20px 0">
        <div class="card" style="padding:16px">
          <div class="card-kicker">Batches totales</div>
          <div style="font-family:var(--font-heading);font-size:28px">{{ batches().length }}</div>
          <div class="text-muted" style="font-size:12px">registrados en este entorno</div>
        </div>
        <div class="card" style="padding:16px">
          <div class="card-kicker">En cola / procesando</div>
          <div style="font-family:var(--font-heading);font-size:28px">{{ activeCount() }}</div>
          <div class="text-muted" style="font-size:12px">queued o processing</div>
        </div>
        <div class="card" style="padding:16px">
          <div class="card-kicker">Indexados</div>
          <div style="font-family:var(--font-heading);font-size:28px">{{ indexedCount() }}</div>
          <div class="text-muted" style="font-size:12px">indexed o draft_created</div>
        </div>
        <div class="card" style="padding:16px">
          <div class="card-kicker">Fallidos</div>
          <div style="font-family:var(--font-heading);font-size:28px">{{ failedCount() }}</div>
          <div class="text-muted" style="font-size:12px">failed o skipped</div>
        </div>
      </div>

      <div class="card" style="padding:18px">
        <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px">
          <div>
            <h4 style="margin:0;display:inline">Batches de ingesta</h4>
            <span class="tag tag-accent" style="margin-left:8px">{{ batches().length }} total</span>
          </div>
        </div>
        <table class="table" style="margin-top:12px">
          <thead>
            <tr>
              <th>Job ID</th>
              <th>Conector</th>
              <th>Progreso</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let b of batches()">
              <td style="font-family:ui-monospace,Menlo,monospace">{{ b.id }}</td>
              <td>{{ b.connector_id }}</td>
              <td>{{ b.processed }} / {{ b.total }}</td>
              <td><span class="tag tag-outline">{{ b.status }}</span></td>
            </tr>
            <tr *ngIf="batches().length === 0">
              <td colspan="4" class="text-muted">Sin batches registrados todavia.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `,
})
export class DashboardComponent implements OnInit {
  private readonly api = inject(IngestaApiService);
  protected readonly batches = signal<IngestionBatch[]>([]);

  protected readonly activeCount = computed(
    () => this.batches().filter((b) => b.status === "queued" || b.status === "processing").length,
  );
  protected readonly indexedCount = computed(
    () => this.batches().filter((b) => b.status === "indexed" || b.status === "draft_created").length,
  );
  protected readonly failedCount = computed(
    () => this.batches().filter((b) => b.status === "failed" || b.status === "skipped").length,
  );

  async ngOnInit(): Promise<void> {
    this.batches.set(await this.api.listBatches());
  }
}
