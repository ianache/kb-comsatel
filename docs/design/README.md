# Arquitectura — kb-comsatel

Este repositorio contiene **dos sistemas independientes** que comparten un mismo dominio de
conocimiento (KM — Knowledge Management) pero se despliegan, versionan y operan por separado:

| Sistema | Ubicación | Qué es | Documento |
|---|---|---|---|
| **Knowledge Context MCP** | `src/` | Servidor MCP (Model Context Protocol) que expone un catálogo de conocimiento de solo lectura a clientes MCP (agentes, IDEs) | [`01-mcp-knowledge-server.md`](./01-mcp-knowledge-server.md) |
| **Portal KM Comsatel** | `portal/` | Aplicación web (Shell + MicroUI + BFF + microservicios) para que operadores humanos gestionen conectores, ingesta y credenciales | [`02-portal-km-comsatel.md`](./02-portal-km-comsatel.md) |

Documentos transversales:

- [`03-security-and-identity.md`](./03-security-and-identity.md) — autenticación, autorización y
  gestión de secretos en ambos sistemas (Keycloak, JWKS, Vault, PKCE).
- [`04-data-flows.md`](./04-data-flows.md) — flujos end-to-end ilustrados (login, búsqueda de
  repositorios GitLab, gestión de credenciales Vault, ingesta OKF).

## Relación entre los dos sistemas

```
                    ┌─────────────────────────────────────┐
                    │         Fuentes de conocimiento       │
                    │   GitLab · Google Drive · Bases de   │
                    │   datos · Documentos subidos          │
                    └───────────────┬───────────────────────┘
                                    │
                    ┌───────────────▼───────────────────────┐
                    │        Portal KM Comsatel (portal/)     │
                    │  Operadores humanos configuran          │
                    │  conectores y disparan ingesta          │
                    └───────────────┬───────────────────────┘
                                    │ produce OKF compilado
                                    ▼
                    ┌─────────────────────────────────────┐
                    │   Catálogo de conocimiento (OKF v0.2)  │
                    │   Markdown + frontmatter validado      │
                    └───────────────┬───────────────────────┘
                                    │ consumido por
                                    ▼
                    ┌─────────────────────────────────────┐
                    │  Knowledge Context MCP (src/)          │
                    │  Agentes/IDEs consultan el catálogo    │
                    │  vía protocolo MCP (search, context)   │
                    └─────────────────────────────────────┘
```

El Portal es la **cara de administración** (quién trae qué documentos, con qué credenciales, bajo
qué gobierno OKF). El servidor MCP es la **cara de consumo** (cómo un agente de IA busca y arma
contexto a partir de ese catálogo ya compilado). Hoy ambos sistemas comparten el mismo repositorio
y el mismo dominio de conocimiento, pero no comparten proceso, base de código, ni ciclo de
despliegue — ver cada documento para el detalle de cada uno.

## Punto de partida para explorar el código

- `CLAUDE.md` (raíz del repo) — guía operativa para trabajar en este repositorio: comandos,
  capas del servidor MCP, workflow de Graphify, esquema OKF.
- `portal/README.md` — guía operativa del Portal (cómo levantar cada pieza en local).
- `00-REQSPEC/REQSPEC_PRD_Knowledge_Context_MCP.md` y
  `00-REQSPEC/REQSPEC_PRD_Portal_Ingesta_KM.md` — especificación funcional original de cada
  sistema.
- `docs/superpowers/specs/` — specs de diseño de features individuales, con fecha, escritas a
  medida que se construyó cada pieza (Conectores, Vault, GitLab operativo, etc.).
