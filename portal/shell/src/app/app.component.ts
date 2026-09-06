import { Component, OnInit, inject } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterLink, RouterLinkActive, RouterOutlet } from "@angular/router";
import { AuthService } from "./auth.service";

const BFF_BASE_URL = (window as unknown as { KM_BFF_URL?: string }).KM_BFF_URL ?? "http://localhost:3000";

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
          <span class="tag" style="white-space:nowrap;background:rgba(255,255,255,0.16);color:#fff">
            Keycloak realm: Apps
          </span>
          <div style="display:flex;align-items:center;gap:8px;padding-left:10px;border-left:1px solid rgba(255,255,255,0.3)">
            <div
              style="width:30px;height:30px;border-radius:50%;background:#fff;display:flex;align-items:center;
                     justify-content:center;font-family:var(--font-heading);font-size:12px;color:var(--color-accent);flex:none"
            >
              {{ initials() }}
            </div>
            <div>
              <div style="font-size:12px;font-family:var(--font-heading);color:#fff">{{ auth.session()?.name }}</div>
              <div style="font-size:10px;color:rgba(255,255,255,0.72)">{{ roleLabel() }}</div>
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
            <a routerLink="/ingesta/vault" routerLinkActive="nav-active" class="nav-item">Credenciales (Vault)</a>
          </nav>
          <div style="padding:16px 18px;border-top:1px solid var(--color-divider)">
            <div class="text-muted" style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em">Sesión activa</div>
            <div style="font-family:var(--font-heading);font-size:16px;margin-top:2px">{{ roleLabel() }}</div>
            <button type="button" class="btn btn-ghost" style="margin-top:8px;padding-inline:0" (click)="logout()">
              Cerrar sesión
            </button>
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

  ngOnInit(): void {
    void this.auth.loadSession();
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

  protected roleLabel(): string {
    const roles = this.auth.session()?.roles ?? [];
    return roles.length > 0 ? roles.join(", ") : "Sin rol asignado";
  }

  protected logout(): void {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = `${BFF_BASE_URL}/api/auth/logout`;
    document.body.appendChild(form);
    form.submit();
  }
}
