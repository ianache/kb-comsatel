import { Injectable, signal } from "@angular/core";

export interface SessionInfo {
  authenticated: boolean;
  name?: string;
  roles?: string[];
}

const BFF_BASE_URL = (window as unknown as { KM_BFF_URL?: string }).KM_BFF_URL ?? "http://localhost:3000";

@Injectable({ providedIn: "root" })
export class AuthService {
  readonly session = signal<SessionInfo | null>(null);

  async loadSession(): Promise<SessionInfo> {
    const response = await fetch(`${BFF_BASE_URL}/api/auth/session`, { credentials: "include" });
    const info: SessionInfo = response.ok ? await response.json() : { authenticated: false };
    this.session.set(info);
    return info;
  }

  /** Sends the browser to the BFF's branded login screen (not straight to Keycloak) —
   * the BFF root shows "Iniciar sesión institucional" and only starts the PKCE flow
   * once the user clicks through. */
  redirectToLogin(): void {
    window.location.href = BFF_BASE_URL;
  }

  hasRole(role: string): boolean {
    return this.session()?.roles?.includes(role) ?? false;
  }
}
