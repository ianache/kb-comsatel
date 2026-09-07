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
