import { Component, OnInit, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, Router } from "@angular/router";
import { GitLabCatalogEntry, GitLabRepoLink, IngestaApiService } from "../../ingesta-api.service";

// Pantalla "Administrar repositorios GitLab" del diseño Claude Design: catálogo con
// checkboxes + selector de rama por repo, "Añadir seleccionados", y tabla de ya vinculados.
@Component({
  selector: "km-administrar-repositorios",
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div style="padding:24px">
      <button type="button" class="btn btn-ghost" style="padding-inline:0;margin-bottom:12px" (click)="volver()">
        ← Volver a Conectores y Fuentes
      </button>

      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap">
        <input class="input" style="max-width:320px" placeholder="Buscar repositorio por nombre…" [(ngModel)]="filterText" name="filterText" />
        <button type="button" class="btn btn-primary" [disabled]="selectedIds().size === 0 || linking()" (click)="addSelected()">
          {{ linking() ? "Añadiendo…" : "Añadir seleccionados (" + selectedIds().size + ")" }}
        </button>
      </div>

      <table class="table">
        <thead>
          <tr>
            <th style="width:32px"></th>
            <th>ID</th>
            <th>Nombre</th>
            <th>Grupo</th>
            <th>Rama</th>
          </tr>
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
            <td style="font-family:ui-monospace,Menlo,monospace;font-size:12px">{{ entry.id }}</td>
            <td>{{ entry.nombre }}</td>
            <td class="text-muted">{{ entry.grupo }}</td>
            <td>
              <select class="input" style="height:32px;padding:0 8px" [disabled]="isLinked(entry.id)" (change)="setBranch(entry.id, $event)">
                <option *ngFor="let rama of entry.ramas_disponibles" [value]="rama" [selected]="rama === entry.rama_default">{{ rama }}</option>
              </select>
            </td>
          </tr>
        </tbody>
      </table>
      <div class="text-muted" *ngIf="filteredCatalog().length === 0" style="margin-top:16px">Ningún repositorio coincide con el filtro.</div>

      <h4 style="margin-top:28px">Repositorios ya vinculados</h4>
      <table class="table" style="margin-top:10px">
        <thead>
          <tr><th>Repositorio</th><th>Rama</th><th>Ruta</th><th>Estado</th></tr>
        </thead>
        <tbody>
          <tr *ngFor="let link of linkedRepos()">
            <td>{{ link.repo }}</td>
            <td><span class="tag tag-outline">{{ link.rama }}</span></td>
            <td style="font-size:13px">{{ link.ruta }}</td>
            <td><span class="tag tag-accent">{{ link.estado }}</span></td>
          </tr>
          <tr *ngIf="linkedRepos().length === 0">
            <td colspan="4" class="text-muted">Sin repositorios vinculados todavía.</td>
          </tr>
        </tbody>
      </table>
    </div>
  `,
})
export class AdministrarRepositoriosComponent implements OnInit {
  private readonly api = inject(IngestaApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private connectorId = "";
  protected filterText = "";
  protected readonly catalog = signal<GitLabCatalogEntry[]>([]);
  protected readonly linkedRepos = signal<GitLabRepoLink[]>([]);
  protected readonly selectedIds = signal<Set<string>>(new Set());
  protected readonly branchById = signal<Record<string, string>>({});
  protected readonly linking = signal(false);

  async ngOnInit(): Promise<void> {
    this.connectorId = this.route.snapshot.paramMap.get("id") ?? "";
    await this.reload();
  }

  private async reload(): Promise<void> {
    const [catalog, linked] = await Promise.all([
      this.api.listGitlabCatalog(),
      this.api.listConnectorRepos(this.connectorId),
    ]);
    this.catalog.set(catalog);
    this.linkedRepos.set(linked);
  }

  protected filteredCatalog(): GitLabCatalogEntry[] {
    const text = this.filterText.trim().toLowerCase();
    const catalog = this.catalog();
    return text ? catalog.filter((entry) => entry.nombre.toLowerCase().includes(text)) : catalog;
  }

  protected isLinked(repoId: string): boolean {
    return this.linkedRepos().some((link) => link.repo_id === repoId);
  }

  protected toggleSelected(repoId: string): void {
    const next = new Set(this.selectedIds());
    if (next.has(repoId)) next.delete(repoId);
    else next.add(repoId);
    this.selectedIds.set(next);
  }

  protected setBranch(repoId: string, event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.branchById.update((current) => ({ ...current, [repoId]: value }));
  }

  protected async addSelected(): Promise<void> {
    if (this.selectedIds().size === 0) return;
    this.linking.set(true);
    try {
      await this.api.linkGitlabRepos(this.connectorId, [...this.selectedIds()], this.branchById());
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
