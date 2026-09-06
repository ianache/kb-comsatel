# Portal KM Comsatel — Arquitectura Shell + MicroUI

Implementa el Portal de Ingesta de Conocimiento descrito en `00-REQSPEC/` y en el diseño
Claude Design "Portal KM Comsatel" (`comsatel-tokens.css`, tema crimson `#c9141d`).

## Arquitectura

```
Browser
  └─ shell/            Angular host app (layout, auth guard, Module Federation host)
       └─ micro-ui-ingesta/   Angular remote MFE (pantallas de ingesta), cargado en runtime
  └─ bff/               Next.js BFF — única app con sesión; hace el Authorization Code + PKCE
       │                contra Keycloak y expone endpoints /api/* que el shell/MFE consumen
       │                con cookie de sesión httpOnly (nunca se expone el access_token al browser)
       └─ services/
            └─ ingestion-api/   FastAPI — microservicio de dominio (conectores, fuentes,
                                  batches, drafts OKF). Valida el token que reenvía el BFF
                                  contra el JWKS de Keycloak (nunca confía en el shell directo).
```

- **Shell**: Angular, monta el layout (header, sidebar, `<router-outlet>`) y carga cada MicroUI
  como remote de Webpack Module Federation. No contiene lógica de negocio.
- **MicroUI**: Angular, un remote por dominio funcional (empieza con `micro-ui-ingesta`; los
  siguientes dominios — gobierno OKF, dashboard de calidad — se agregan como nuevos remotes bajo
  `portal/micro-ui-<dominio>/`).
- **BFF**: Next.js (JavaScript/Node), dueño del flujo OIDC Authorization Code + PKCE (RFC 7636)
  contra Keycloak (`realm: comsatel-km-prod`). Guarda la sesión en cookie httpOnly firmada;
  el browser nunca ve el `access_token`. Expone rutas `/api/ingesta/*` que reenvían al
  microservicio FastAPI con `Authorization: Bearer <token>` inyectado server-side.
- **Microservicios**: Python + FastAPI, uno por dominio (`services/ingestion-api` es el primero).
  Cada uno valida el JWT recibido contra el JWKS de Keycloak (nunca confía en la identidad que
  declara el BFF sin validarla) y aplica RBAC por rol (`Administrador KM`, `Curador`, `Operador`,
  `Auditor` — sección 5 del PRD).

## Por qué BFF + PKCE

El shell/MicroUI corren 100% en el browser (SPA), así que el flujo OIDC "puro" con PKCE en el
cliente expondría el `access_token` en el browser. En su lugar, el **BFF** ejecuta el
Authorization Code + PKCE (genera `code_verifier`/`code_challenge`, intercambia el `code` por
tokens en el backend) y solo entrega al browser una cookie de sesión opaca — el patrón
"BFF pattern" recomendado por OAuth 2.1 para SPAs. Los microservicios FastAPI nunca hablan con
Keycloak directamente para login; solo validan JWTs vía JWKS.

## Ejecutar en local

```bash
# BFF (requiere Keycloak accesible en KEYCLOAK_ISSUER)
cd portal/bff && npm install && npm run dev

# Shell
cd portal/shell && npm install && npm start

# MicroUI de ingesta
cd portal/micro-ui-ingesta && npm install && npm start

# Microservicio de ingesta
cd portal/services/ingestion-api && pip install -r requirements.txt && uvicorn app.main:app --reload --port 8001
```

Ver `docs/manual-tests/` en la raíz del repo para los tokens de diseño (`comsatel-tokens.css`)
usados por shell y MicroUI, y `00-REQSPEC/REQSPEC_PRD_Portal_Ingesta_KM.md` para el contrato
funcional completo.
