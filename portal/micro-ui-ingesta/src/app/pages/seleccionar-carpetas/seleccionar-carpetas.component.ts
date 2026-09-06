import { Component, OnInit, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, Router } from "@angular/router";
import { DriveCatalogEntry, DriveFolderLink, IngestaApiService } from "../../ingesta-api.service";

// Pantalla dedicada "Seleccionar carpetas" para conectores Google Drive — mismo patrón que
// Administrar repositorios (catálogo + selección + vinculados), sin selector de rama.
@Component({
  selector: "km-seleccionar-carpetas",
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div style="padding:24px">
      <button type="button" class="btn btn-ghost" style="padding-inline:0;margin-bottom:12px" (click)="volver()">
        ← Volver a Conectores y Fuentes
      </button>

      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap">
        <input class="input" style="max-width:320px" placeholder="Buscar carpeta por nombre…" [(ngModel)]="filterText" name="filterText" />
        <button type="button" class="btn btn-primary" [disabled]="selectedIds().size === 0 || linking()" (click)="addSelected()">
          {{ linking() ? "Añadiendo…" : "Añadir seleccionadas (" + selectedIds().size + ")" }}
        </button>
      </div>

      <table class="table">
        <thead>
          <tr><th style="width:32px"></th><th>Carpeta</th><th>Tipo</th></tr>
        </thead>
        <tbody>
          <tr *ngFor="let entry of filteredCatalog()">
            <td>
              <input
                type="checkbox"
                style="accent-color:var(--color-accent);width:16px;height:16px"
                [checked]="selectedIds().has(entry.id)"
                [disabled]="isLinked(entry.id)"
                (change)="toggleSelected(entry.id)"
              />
            </td>
            <td>{{ entry.path }}</td>
            <td class="text-muted">{{ entry.tipo }}</td>
          </tr>
        </tbody>
      </table>
      <div class="text-muted" *ngIf="filteredCatalog().length === 0" style="margin-top:16px">Ninguna carpeta coincide con el filtro.</div>

      <h4 style="margin-top:28px">Carpetas ya vinculadas</h4>
      <table class="table" style="margin-top:10px">
        <thead><tr><th>Carpeta</th><th>Tipo</th></tr></thead>
        <tbody>
          <tr *ngFor="let link of linkedFolders()">
            <td>{{ link.path }}</td>
            <td class="text-muted">{{ link.tipo }}</td>
          </tr>
          <tr *ngIf="linkedFolders().length === 0">
            <td colspan="2" class="text-muted">Sin carpetas vinculadas todavía.</td>
          </tr>
        </tbody>
      </table>
    </div>
  `,
})
export class SeleccionarCarpetasComponent implements OnInit {
  private readonly api = inject(IngestaApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private connectorId = "";
  protected filterText = "";
  protected readonly catalog = signal<DriveCatalogEntry[]>([]);
  protected readonly linkedFolders = signal<DriveFolderLink[]>([]);
  protected readonly selectedIds = signal<Set<string>>(new Set());
  protected readonly linking = signal(false);

  async ngOnInit(): Promise<void> {
    this.connectorId = this.route.snapshot.paramMap.get("id") ?? "";
    await this.reload();
  }

  private async reload(): Promise<void> {
    const [catalog, linked] = await Promise.all([
      this.api.listGdriveCatalog(),
      this.api.listConnectorFolders(this.connectorId),
    ]);
    this.catalog.set(catalog);
    this.linkedFolders.set(linked);
  }

  protected filteredCatalog(): DriveCatalogEntry[] {
    const text = this.filterText.trim().toLowerCase();
    const catalog = this.catalog();
    return text ? catalog.filter((entry) => entry.path.toLowerCase().includes(text)) : catalog;
  }

  protected isLinked(folderId: string): boolean {
    return this.linkedFolders().some((link) => link.id.endsWith(`-${folderId}`));
  }

  protected toggleSelected(folderId: string): void {
    const next = new Set(this.selectedIds());
    if (next.has(folderId)) next.delete(folderId);
    else next.add(folderId);
    this.selectedIds.set(next);
  }

  protected async addSelected(): Promise<void> {
    if (this.selectedIds().size === 0) return;
    this.linking.set(true);
    try {
      await this.api.linkGdriveFolders(this.connectorId, [...this.selectedIds()]);
      this.selectedIds.set(new Set());
      await this.reload();
    } finally {
      this.linking.set(false);
    }
  }

  protected volver(): void {
    void this.router.navigate(["/ingesta/conectores"]);
  }
}
