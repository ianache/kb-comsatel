import { Component, OnInit, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, Router } from "@angular/router";
import { GitLabBranches, GitLabRepoLink, GitLabRepoSelection, GitLabSearchResult, IngestaApiService } from "../../ingesta-api.service";

interface SearchRow {
  entry: GitLabSearchResult;
  branches: GitLabBranches | null;
  branchesLoading: boolean;
  branchesError: string | null;
  selectedBranch: string;
}

// Pantalla "Administrar repositorios GitLab" del diseño Claude Design: búsqueda en vivo contra
// la API real de GitLab (por nombre o ID), carga de ramas al seleccionar, y tabla de vinculados.
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
        <input
          class="input"
          style="max-width:320px"
          placeholder="Buscar por nombre o ID de repositorio…"
          [(ngModel)]="searchText"
          name="searchText"
          (ngModelChange)="onSearchTextChange($event)"
        />
        <button type="button" class="btn btn-primary" [disabled]="selectedRows().length === 0 || linking()" (click)="addSelected()">
          {{ linking() ? "Añadiendo…" : "Añadir seleccionados (" + selectedRows().length + ")" }}
        </button>
      </div>

      <div class="card" style="padding:12px;margin-bottom:14px;background:var(--color-danger-100,#fee2e2)" *ngIf="errorBanner()">
        <div style="font-size:13px;color:var(--color-danger-800,#991b1b)">{{ errorBanner() }}</div>
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
          <tr *ngFor="let row of rows()">
            <td>
              <input
                type="checkbox"
                style="accent-color:var(--color-accent);width:16px;height:16px"
                [checked]="isSelected(row.entry.id)"
                [disabled]="isLinked(row.entry.id)"
                (change)="toggleSelected(row, $event)"
              />
            </td>
            <td style="font-family:ui-monospace,Menlo,monospace;font-size:12px">{{ row.entry.id }}</td>
            <td>{{ row.entry.nombre }}</td>
            <td class="text-muted">{{ row.entry.grupo }}</td>
            <td>
              <span class="text-muted" style="font-size:12px" *ngIf="row.branchesLoading">Cargando ramas…</span>
              <span class="text-muted" style="font-size:12px" *ngIf="row.branchesError">{{ row.branchesError }}</span>
              <select
                class="input"
                style="height:32px;padding:0 8px"
                *ngIf="row.branches && !row.branchesLoading"
                [disabled]="isLinked(row.entry.id)"
                (change)="setBranch(row, $event)"
              >
                <option *ngFor="let rama of row.branches.ramas_disponibles" [value]="rama" [selected]="rama === row.selectedBranch">{{ rama }}</option>
              </select>
            </td>
          </tr>
        </tbody>
      </table>
      <div class="text-muted" *ngIf="searchText.trim().length === 0" style="margin-top:16px">
        Escribe un nombre o ID de repositorio para buscar en GitLab.
      </div>
      <div class="text-muted" *ngIf="searchText.trim().length > 0 && !searching() && rows().length === 0" style="margin-top:16px">
        Ningún repositorio coincide con la búsqueda.
      </div>

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
  protected searchText = "";
  protected readonly rows = signal<SearchRow[]>([]);
  protected readonly linkedRepos = signal<GitLabRepoLink[]>([]);
  protected readonly linking = signal(false);
  protected readonly searching = signal(false);
  protected readonly errorBanner = signal<string | null>(null);

  private searchDebounce: ReturnType<typeof setTimeout> | null = null;

  async ngOnInit(): Promise<void> {
    this.connectorId = this.route.snapshot.paramMap.get("id") ?? "";
    this.linkedRepos.set(await this.api.listConnectorRepos(this.connectorId));
  }

  protected onSearchTextChange(value: string): void {
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
    const text = value.trim();
    if (!text) {
      this.rows.set([]);
      return;
    }
    this.searchDebounce = setTimeout(() => void this.runSearch(text), 300);
  }

  private async runSearch(text: string): Promise<void> {
    this.searching.set(true);
    this.errorBanner.set(null);
    this.selectedIds.clear();
    try {
      const outcome = await this.api.searchGitlabRepos(this.connectorId, text);
      if (!outcome.ok) {
        this.errorBanner.set(`No se pudo conectar a GitLab: ${outcome.error}`);
        this.rows.set([]);
        return;
      }
      this.rows.set(
        outcome.results.map((entry) => ({ entry, branches: null, branchesLoading: false, branchesError: null, selectedBranch: "" })),
      );
    } catch {
      this.errorBanner.set("No se pudo conectar a GitLab: error de red.");
      this.rows.set([]);
    } finally {
      this.searching.set(false);
    }
  }

  protected isLinked(repoId: string): boolean {
    return this.linkedRepos().some((link) => link.repo_id === repoId);
  }

  protected isSelected(repoId: string): boolean {
    return this.rows().some((row) => row.entry.id === repoId && row.branches !== null && row.selectedBranch !== "" && this.selectedIds.has(repoId));
  }

  private readonly selectedIds = new Set<string>();

  protected async toggleSelected(row: SearchRow, event?: Event): Promise<void> {
    const checkbox = event?.target as HTMLInputElement | undefined;

    if (this.selectedIds.has(row.entry.id)) {
      this.selectedIds.delete(row.entry.id);
      this.rows.update((current) => current.map((r) => (r.entry.id === row.entry.id ? { ...r, branches: null, selectedBranch: "" } : r)));
      return;
    }

    this.selectedIds.add(row.entry.id);
    this.rows.update((current) => current.map((r) => (r.entry.id === row.entry.id ? { ...r, branchesLoading: true, branchesError: null } : r)));

    const outcome = await this.api.getGitlabBranches(this.connectorId, row.entry.id);
    if (!outcome.ok) {
      this.selectedIds.delete(row.entry.id);
      this.rows.update((current) =>
        current.map((r) =>
          r.entry.id === row.entry.id
            ? { ...r, branchesLoading: false, branchesError: outcome.error }
            : r,
        ),
      );
      // Angular's change detection only rewrites a [checked] binding when the bound
      // expression's *value* differs from the previous cycle. isSelected() evaluated
      // to false both before the user's click (row.branches was null) and now (we just
      // removed the id from selectedIds), so the binding value never changes and Angular
      // skips the DOM write — leaving the checkbox showing whatever the native click left
      // behind (checked). Force the actual DOM property so the failure is visible.
      if (checkbox) checkbox.checked = false;
      return;
    }

    const { branches } = outcome;
    this.rows.update((current) =>
      current.map((r) =>
        r.entry.id === row.entry.id
          ? { ...r, branches, branchesLoading: false, branchesError: null, selectedBranch: branches.rama_default }
          : r,
      ),
    );
  }

  protected setBranch(row: SearchRow, event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.rows.update((current) => current.map((r) => (r.entry.id === row.entry.id ? { ...r, selectedBranch: value } : r)));
  }

  protected selectedRows(): SearchRow[] {
    return this.rows().filter((row) => this.selectedIds.has(row.entry.id) && row.branches !== null);
  }

  protected async addSelected(): Promise<void> {
    const selections: GitLabRepoSelection[] = this.selectedRows().map((row) => ({
      repo_id: row.entry.id,
      repo_name: row.entry.nombre,
      grupo: row.entry.grupo,
      rama: row.selectedBranch,
    }));
    if (selections.length === 0) return;

    this.linking.set(true);
    try {
      await this.api.linkGitlabRepos(this.connectorId, selections);
      this.selectedIds.clear();
      this.rows.set([]);
      this.searchText = "";
      this.linkedRepos.set(await this.api.listConnectorRepos(this.connectorId));
    } finally {
      this.linking.set(false);
    }
  }

  protected volver(): void {
    void this.router.navigate(["/ingesta/conectores"]);
  }
}
