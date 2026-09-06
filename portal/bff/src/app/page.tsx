import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

// Unauthenticated visitors see the branded login screen below — a faithful
// reproduction of the "isLogin" state of the Portal KM Comsatel Claude Design
// mockup (Portal KM Comsatel.dc.html), not a simplified stand-in. Both the SSO
// button and the direct-credentials button start the same Authorization Code +
// PKCE flow: this BFF issues sessions only via Keycloak, never via a password
// grant, so "direct credentials" still routes through Keycloak's own login form.
// Once a session exists, control hands off to the Angular shell.
export default async function RootPage() {
  const session = await getSession();
  if (session) {
    redirect(process.env.SHELL_URL ?? "http://localhost:4200");
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--color-bg)", color: "var(--color-text)", fontFamily: "var(--font-body)", display: "flex", flexDirection: "column" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "16px 32px",
          background: "linear-gradient(120deg,var(--color-accent-700),var(--color-accent))",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              width: 32,
              height: 32,
              background: "#fff",
              borderRadius: "var(--radius-md)",
              flex: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--color-accent)",
              fontFamily: "var(--font-heading)",
              fontWeight: 700,
            }}
          >
            K
          </div>
          <span style={{ fontFamily: "var(--font-heading)", fontSize: 18, fontWeight: 700, color: "#fff" }}>COMSATEL</span>
          <span style={{ fontSize: 12, letterSpacing: "0.06em", color: "rgba(255,255,255,0.75)" }}>PORTAL KM</span>
          <span className="tag" style={{ marginLeft: 8, whiteSpace: "nowrap", background: "rgba(255,255,255,0.16)", color: "#fff" }}>
            OKE Producción · OIDC Keycloak
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 12, color: "rgba(255,255,255,0.75)" }}>
          <span>TLS 1.3 / mTLS forzado</span>
          <a href="#" style={{ color: "#fff" }}>
            Soporte
          </a>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "10px 32px",
          borderBottom: "1px solid var(--color-divider)",
          fontSize: 12,
        }}
        className="text-muted"
      >
        <div style={{ display: "flex", gap: 16, alignItems: "center", fontFamily: "ui-monospace,Menlo,monospace" }}>
          <span>GATEWAY-SEC-01</span>
          <span>/</span>
          <span>OIDC Proxy v2.4.1</span>
          <span>/</span>
          <span>PKCE-S256-ENFORCED</span>
        </div>
        <div style={{ fontFamily: "ui-monospace,Menlo,monospace" }}>OKE-CLUSTER-SA-EAST</div>
      </div>

      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "460px 1fr", gap: 32, maxWidth: 1400, width: "100%", margin: "0 auto", padding: "36px 32px 48px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="card" style={{ padding: 28 }}>
            <h6 style={{ color: "var(--color-accent)" }}>Portal de ingesta de conocimiento</h6>
            <h1 style={{ marginTop: 6, fontSize: 32 }}>Iniciar sesión institucional</h1>
            <p className="text-muted" style={{ maxWidth: "44ch" }}>
              Acceso federado a la plataforma de ingesta y gobierno de conocimiento técnico de Comsatel. Autenticación
              delegada mediante OIDC / Red Hat Keycloak.
            </p>
            <a
              href="/api/auth/login"
              className="btn btn-primary"
              style={{ marginTop: 16, width: "100%", justifyContent: "space-between", padding: "14px 16px", height: "auto" }}
            >
              <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
                <span style={{ fontSize: 15, color: "#fff" }}>Continuar con Comsatel SSO</span>
                <span style={{ fontSize: 11, fontFamily: "var(--font-body)", fontWeight: 400, opacity: 0.85, color: "#fff" }}>
                  Keycloak OIDC · realm: Apps
                </span>
              </span>
              <span className="tag" style={{ background: "#fff", color: "var(--color-accent-800)" }}>
                Recomendado
              </span>
            </a>

            <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "20px 0" }} className="text-muted">
              <div style={{ flex: 1, height: 1, background: "var(--color-divider)" }} />
              <span style={{ fontSize: 11, letterSpacing: "0.08em" }}>O CREDENCIALES DIRECTAS DE REALM</span>
              <div style={{ flex: 1, height: 1, background: "var(--color-divider)" }} />
            </div>
            <div className="field" style={{ marginBottom: 14 }}>
              <label>Usuario / correo institucional</label>
              <input className="input" placeholder="operador@comsatel.com.pe" disabled />
            </div>
            <div className="field" style={{ marginBottom: 14 }}>
              <label>Contraseña de directorio</label>
              <input className="input" type="password" placeholder="••••••••••••" disabled />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 18 }}>
              <div className="card" style={{ padding: "10px 12px" }}>
                <div className="text-muted" style={{ fontSize: 10, letterSpacing: "0.06em" }}>
                  REALM OIDC
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 13 }}>Apps</span>
                  <span className="tag tag-accent">Activo</span>
                </div>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                <input type="checkbox" defaultChecked style={{ accentColor: "var(--color-accent)", width: 16, height: 16 }} disabled />
                Recordar MFA (12h)
              </label>
            </div>
            {/* This BFF never handles passwords directly (Authorization Code + PKCE only) —
                the fields above are illustrative per the design; this button starts the
                same Keycloak-hosted login as the SSO button above. */}
            <a href="/api/auth/login" className="btn btn-secondary btn-block">
              Acceder al portal
            </a>
          </div>
          <div className="card" style={{ padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div className="card-kicker">Gobernanza criptográfica · sección 7 PRD</div>
              <span className="tag tag-neutral">Confidencial</span>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "6px 0" }}>
              <span className="tag tag-outline">OAuth 2.1</span>
              <span className="tag tag-outline">OpenID Connect Core 1.0</span>
              <span className="tag tag-outline">PKCE RFC 7636</span>
              <span className="tag tag-outline">Vault Brokerage</span>
            </div>
            <p className="card-body">
              Uso exclusivo para personal técnico autorizado. Cada operación de ingesta, reproceso y consulta de
              candidatos OKF queda catalogada con correlation ID en auditoría inmutable.
            </p>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h4 style={{ margin: 0 }}>Telemetría operacional</h4>
              <div className="text-muted" style={{ fontSize: 12 }}>
                Clúster OKE Producción · sa-east-1
              </div>
            </div>
            <span className="tag tag-accent">99.98% SLA</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div className="card" style={{ padding: 16 }}>
              <div className="card-kicker">Corpus</div>
              <div style={{ fontFamily: "var(--font-heading)", fontSize: 28 }}>1,248</div>
              <div className="text-muted" style={{ fontSize: 12 }}>
                documentos ingeridos · +342 hoy
              </div>
            </div>
            <div className="card" style={{ padding: 16 }}>
              <div className="card-kicker">Gobierno OKF v0.2</div>
              <div style={{ fontFamily: "var(--font-heading)", fontSize: 28 }}>4</div>
              <div className="text-muted" style={{ fontSize: 12 }}>
                candidatos draft en revisión
              </div>
            </div>
            <div className="card" style={{ padding: 16 }}>
              <div className="card-kicker">Throughput ingesta</div>
              <div style={{ fontFamily: "var(--font-heading)", fontSize: 28 }}>128</div>
              <div className="text-muted" style={{ fontSize: 12 }}>
                docs/seg · 3 workers Kafka
              </div>
            </div>
            <div className="card" style={{ padding: 16 }}>
              <div className="card-kicker">Calidad de extracción</div>
              <div style={{ fontFamily: "var(--font-heading)", fontSize: 28 }}>97.4%</div>
              <div className="text-muted" style={{ fontSize: 12 }}>
                Docling + Tika fallback
              </div>
            </div>
          </div>
          <div className="card" style={{ padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div className="card-kicker">Latencia pipeline de ingesta (24h)</div>
              <span className="text-muted" style={{ fontSize: 12 }}>
                p99: 142ms
              </span>
            </div>
            <svg viewBox="0 0 400 90" style={{ width: "100%", height: 90, marginTop: 4 }} preserveAspectRatio="none">
              <path
                d="M0,60 C30,55 50,35 80,40 C110,45 130,20 160,25 C190,30 210,55 240,50 C270,45 290,15 320,20 C350,25 370,45 400,35"
                fill="none"
                stroke="var(--color-accent)"
                strokeWidth="2"
              />
            </svg>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }} className="text-muted">
              <span>00:00 UTC</span>
              <span>08:00</span>
              <span>16:00</span>
              <span>ahora</span>
            </div>
          </div>
          <div className="card" style={{ padding: 18 }}>
            <div className="card-kicker" style={{ marginBottom: 6 }}>
              Servicios del ecosistema KM
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 13 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>Keycloak IdP (Apps)</span>
                <span className="text-muted">lat: 4ms · óptimo</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>Kafka Ingestion Stream</span>
                <span className="text-muted">3/3 workers · lag: 0</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>Qdrant Vector Engine</span>
                <span className="text-muted">proyecciones sincronizadas</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>Vault Secrets Broker</span>
                <span className="text-muted">HSM FIPS 140-2 L3</span>
              </div>
            </div>
          </div>
          <div className="card" style={{ padding: 18 }}>
            <div className="card-kicker" style={{ marginBottom: 6 }}>
              Bitácora de publicación y soporte
            </div>
            <p className="card-body" style={{ marginBottom: 8 }}>
              <strong>OKF:</strong> concepto &quot;Política de versionamiento de API&quot; promovido a draft hace 4
              horas tras Merge Request aprobada.
            </p>
            <p className="card-body" style={{ marginBottom: 8 }}>
              <strong>Mantenimiento:</strong> próxima ventana de reproceso programada a las 02:00 UTC, sin
              interrupción de consultas.
            </p>
            <div className="text-muted" style={{ fontSize: 12 }}>
              Soporte DevOps/SecOps: <a href="#">devops@comsatel.com.pe</a> · #km-portal-ops
            </div>
          </div>
        </div>
      </div>

      <div
        style={{ display: "flex", justifyContent: "space-between", padding: "16px 32px", borderTop: "1px solid var(--color-divider)", fontSize: 12 }}
        className="text-muted"
      >
        <span>© 2026 COMSATEL Telemetría &amp; Seguridad S.A. · Plataforma KM</span>
        <div style={{ display: "flex", gap: 16 }}>
          <span>Session Policy: STRICT-SAMESITE</span>
          <span>Geo-Fencing Active</span>
        </div>
      </div>
    </div>
  );
}
