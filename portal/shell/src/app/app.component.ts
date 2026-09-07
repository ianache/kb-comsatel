import { Component, OnInit, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterLink, RouterLinkActive, RouterOutlet } from "@angular/router";
import { AuthService } from "./auth.service";
import shellPackageJson from "../../package.json";

const BFF_BASE_URL = (window as unknown as { KM_BFF_URL?: string }).KM_BFF_URL ?? "http://localhost:3000";

type ServiceHealth = "ok" | "down" | "checking";

interface ServiceRow {
  key: string;
  label: string;
  health: ServiceHealth;
}

// Layout-only host, reproducing the shell chrome from the "Portal KM Comsatel" Claude
// Design mockup: crimson gradient header (logo, search, status tags, user avatar) +
// white sidebar nav with a solid-red active item. No business logic lives here —
// each MicroUI remote renders inside <router-outlet>.
@Component({
  selector: "km-root",
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div style="min-height:100vh;display:flex;flex-direction:column;background:var(--color-bg)">
      <header
        style="display:flex;align-items:center;justify-content:space-between;gap:16px;padding:10px 20px;flex:none;
               background:linear-gradient(120deg,var(--color-accent-700),var(--color-accent))"
      >
        <div style="display:flex;align-items:center;gap:20px;flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:10px;flex:none">
            <div
              style="width:28px;height:28px;background:#fff;border-radius:var(--radius-sm);flex:none;display:flex;
                     align-items:center;justify-content:center;color:var(--color-accent);font-family:var(--font-heading);
                     font-weight:700;font-size:13px"
            >
              K
            </div>
            <div>
              <div style="font-family:var(--font-heading);font-size:14px;font-weight:700;line-height:1.15;color:#fff">
                COMSATEL KM
              </div>
              <div style="font-size:10px;line-height:1.1;color:rgba(255,255,255,0.72)">Portal de Ingesta</div>
            </div>
          </div>
          <input
            class="input"
            style="height:32px;max-width:360px;flex:1"
            placeholder="Buscar artefactos, hashes o MRs..."
          />
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex:none">
          <button type="button" class="btn btn-ghost btn-icon" style="color:#fff" aria-label="Notificaciones">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"></path>
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"></path>
            </svg>
          </button>
          <div style="position:relative;padding-left:10px;border-left:1px solid rgba(255,255,255,0.3)">
            <button
              type="button"
              style="background:none;border:none;padding:0;cursor:pointer;display:flex;align-items:center"
              (click)="toggleUserMenu()"
            >
              <div
                style="width:30px;height:30px;border-radius:50%;background:#fff;display:flex;align-items:center;
                       justify-content:center;font-family:var(--font-heading);font-size:12px;color:var(--color-accent);flex:none"
              >
                {{ initials() }}
              </div>
            </button>
            <div
              *ngIf="userMenuOpen()"
              class="card"
              style="position:absolute;top:44px;right:0;width:260px;padding:12px;z-index:60;box-shadow:var(--shadow-lg)"
            >
              <div style="padding:4px 6px 10px">
                <div style="font-family:var(--font-heading);font-size:14px">{{ auth.session()?.name }}</div>
                <div class="text-muted" style="font-size:12px">{{ auth.session()?.email }}</div>
              </div>
              <div style="display:flex;flex-direction:column;gap:2px">
                <div
                  *ngFor="let role of auth.session()?.roles"
                  style="padding:6px;font-size:12px;color:var(--color-text)"
                  class="text-muted"
                >
                  {{ role }}
                </div>
              </div>
              <div style="height:1px;background:var(--color-divider);margin:8px 0"></div>
              <button
                type="button"
                disabled
                style="display:block;width:100%;text-align:left;background:none;border:none;padding:8px 6px;
                       font-size:13px;cursor:not-allowed;color:var(--color-neutral-400);border-radius:var(--radius-sm)"
              >
                Settings
              </button>
              <button
                type="button"
                style="display:block;width:100%;text-align:left;background:none;border:none;padding:8px 6px;
                       font-size:13px;cursor:pointer;color:var(--color-accent);border-radius:var(--radius-sm)"
                (click)="logout()"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      <div style="display:flex;flex:1;min-height:0">
        <aside style="width:256px;flex:none;background:#fff;border-right:1px solid var(--color-divider);display:flex;flex-direction:column">
          <div class="text-muted" style="padding:16px 18px 8px;font-size:11px;letter-spacing:0.08em;text-transform:uppercase">
            Plataforma KM
          </div>
          <nav style="flex:1;padding:4px 12px;display:flex;flex-direction:column;gap:2px">
            <a
              routerLink="/ingesta"
              routerLinkActive="nav-active"
              [routerLinkActiveOptions]="{ exact: true }"
              class="nav-item"
              >Panel operacional</a
            >
            <a routerLink="/ingesta/conectores" routerLinkActive="nav-active" class="nav-item">Conectores y fuentes</a>
            <a routerLink="/ingesta/ejecucion" routerLinkActive="nav-active" class="nav-item">Ejecución y monitoreo</a>
            <a routerLink="/ingesta/vault" routerLinkActive="nav-active" class="nav-item">Credenciales (Vault)</a>
          </nav>
          <div
            style="padding:12px 18px;border-top:1px solid var(--color-divider);position:relative;display:flex;
                   align-items:center;justify-content:space-between"
          >
            <span class="text-muted" style="font-size:11px;font-family:ui-monospace,Menlo,monospace">v{{ shellVersion }}</span>
            <button
              type="button"
              style="background:none;border:none;padding:4px;cursor:pointer;display:flex;align-items:center"
              (click)="toggleStatusMenu()"
              aria-label="Estado de servicios"
            >
              <span [style]="statusDotStyle()"></span>
            </button>
            <div
              *ngIf="statusMenuOpen()"
              class="card"
              style="position:absolute;bottom:44px;right:12px;width:240px;padding:12px;z-index:60;box-shadow:var(--shadow-lg)"
            >
              <div class="card-kicker" style="margin-bottom:6px">Estado de servicios</div>
              <div style="display:flex;flex-direction:column;gap:8px">
                <div
                  *ngFor="let svc of serviceRows()"
                  style="display:flex;justify-content:space-between;align-items:center;font-size:13px"
                >
                  <span>{{ svc.label }}</span>
                  <span style="display:flex;align-items:center;gap:6px">
                    <span [style]="dotStyle(svc.health)"></span>
                    <span class="text-muted" style="font-size:11px">{{ healthLabel(svc.health) }}</span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </aside>

        <main style="flex:1;min-width:0;overflow-y:auto">
          <router-outlet />
        </main>
      </div>
    </div>
  `,
  styles: [
    `
      .nav-item {
        display: flex;
        align-items: center;
        height: 40px;
        padding: 0 12px;
        border-radius: var(--radius-md);
        font-size: 14px;
        font-weight: 500;
        color: var(--color-text);
        text-decoration: none;
      }
      .nav-item:hover {
        background: var(--color-neutral-100);
      }
      .nav-item.nav-active {
        background: var(--color-accent);
        color: #fff;
      }
    `,
  ],
})
export class AppComponent implements OnInit {
  protected readonly auth = inject(AuthService);
  protected readonly shellVersion = shellPackageJson.version;

  protected readonly userMenuOpen = signal(false);
  protected readonly statusMenuOpen = signal(false);
  protected readonly serviceRows = signal<ServiceRow[]>([
    { key: "bff", label: "BFF Gateway", health: "checking" },
    { key: "ingestion", label: "Microservicios", health: "checking" },
  ]);

  ngOnInit(): void {
    void this.auth.loadSession();
    void this.checkServices();
  }

  protected initials(): string {
    const name = this.auth.session()?.name ?? "";
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("");
  }

  protected toggleUserMenu(): void {
    this.userMenuOpen.update((open) => !open);
  }

  protected toggleStatusMenu(): void {
    const opening = !this.statusMenuOpen();
    this.statusMenuOpen.set(opening);
    if (opening) void this.checkServices();
  }

  private async checkServices(): Promise<void> {
    const checks: Array<[string, string]> = [
      ["bff", `${BFF_BASE_URL}/api/health`],
      ["ingestion", `${BFF_BASE_URL}/api/health/ingestion`],
    ];
    const results = await Promise.all(
      checks.map(async ([key, url]) => {
        try {
          const response = await fetch(url, { credentials: "include" });
          return { key, health: (response.ok ? "ok" : "down") as ServiceHealth };
        } catch {
          return { key, health: "down" as ServiceHealth };
        }
      }),
    );
    this.serviceRows.update((rows) =>
      rows.map((row) => {
        const result = results.find((r) => r.key === row.key);
        return result ? { ...row, health: result.health } : row;
      }),
    );
  }

  protected healthLabel(health: ServiceHealth): string {
    if (health === "ok") return "Operativo";
    if (health === "down") return "Caído";
    return "Verificando…";
  }

  private colorFor(health: ServiceHealth): string {
    if (health === "ok") return "#22c55e";
    if (health === "down") return "#ef4444";
    return "#94a3b8";
  }

  protected dotStyle(health: ServiceHealth): string {
    return `display:inline-block;width:8px;height:8px;border-radius:50%;background:${this.colorFor(health)}`;
  }

  protected statusDotStyle(): string {
    const rows = this.serviceRows();
    const worst: ServiceHealth = rows.some((r) => r.health === "down")
      ? "down"
      : rows.some((r) => r.health === "checking")
        ? "checking"
        : "ok";
    return `display:inline-block;width:9px;height:9px;border-radius:50%;background:${this.colorFor(worst)}`;
  }

  protected logout(): void {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = `${BFF_BASE_URL}/api/auth/logout`;
    document.body.appendChild(form);
    form.submit();
  }
}
