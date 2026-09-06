# Seguridad e identidad

Cómo se maneja autenticación, autorización y secretos en ambos sistemas del repositorio.

## Identidad: Keycloak, en dos configuraciones distintas

Los dos sistemas hablan con **realms/clients de Keycloak potencialmente distintos** y de forma
independiente — no comparten sesión ni proceso de login:

| | Portal KM Comsatel | Knowledge Context MCP (HTTP mode) |
|---|---|---|
| Quién inicia el login | El BFF (Next.js), server-side | No aplica — solo valida tokens ya emitidos |
| Flujo | Authorization Code + PKCE (RFC 7636) | Ninguno — modo bearer-only |
| Validación de token | JWKS, en `ingestion-api` (Python) | JWKS, en `security/keycloak-principal-resolver.ts` (Node) |
| Config real usada hoy | `KEYCLOAK_ISSUER=https://oauth2.qa.comsatel.com.pe/realms/Apps` | `KCP_KEYCLOAK_ISSUER` (I2+) |

## Flujo de login del Portal (BFF pattern)

```
1. Browser → GET /  (BFF, Next.js)
     BFF no tiene sesión → sirve "Iniciar sesión institucional"
2. Usuario click "Continuar con Comsatel SSO" → GET /api/auth/login
     BFF genera code_verifier + code_challenge (PKCE), guarda code_verifier
     en una cookie temporal, redirige a Keycloak con el code_challenge
3. Usuario se autentica en Keycloak (fuera del control del Portal)
4. Keycloak redirige a GET /api/auth/callback?code=...&state=...
     BFF intercambia code + code_verifier por tokens (Authorization Code + PKCE)
     BFF decodifica el access_token (sub, name, email, realm_access.roles)
     BFF crea una sesión server-side (store file-backed) y setea una cookie
     httpOnly opaca (sameSite=lax) — el browser NUNCA recibe el access_token
5. Browser → redirige al Shell (Angular, puerto 4200)
     Shell llama GET /api/auth/session (credentials: include) para saber
     si hay sesión y qué roles tiene — recibe {authenticated, name, email, roles}
6. Cada llamada de dominio del MicroUI (vía BFF) inyecta
     Authorization: Bearer <access_token> server-side, desde la sesión guardada
7. ingestion-api (FastAPI) valida ese JWT contra el JWKS de Keycloak
     antes de confiar en la identidad — nunca confía en lo que dice el BFF sin
     validar la firma/issuer/expiración criptográficamente
```

Por qué este patrón y no OIDC puro en el browser: una SPA que ejecuta PKCE en el cliente termina
con el `access_token` accesible en el browser (memoria de JS, en el peor caso `localStorage`),
vulnerable a robo vía XSS. El BFF pattern (recomendado por OAuth 2.1 para SPAs) mueve todo el
manejo de tokens al servidor y entrega al browser solo un identificador de sesión opaco.

## Autorización (RBAC)

Cuatro roles definidos en la sección 5 del PRD del Portal:

| Rol | Alcance típico |
|---|---|
| `km-admin` | Todo — incluye gestión de credenciales Vault y conectores |
| `km-curador` | Curaduría de contenido/dominio |
| `km-operador` | Operación de ingesta |
| `km-auditor` | Solo lectura |

`ingestion-api` aplica esto endpoint por endpoint vía `require_role(*roles)` (ver
`app/core/security.py`). El Shell no oculta funcionalidad por rol de forma exhaustiva hoy — la
autorización real vive en el backend; el frontend refleja los roles informativamente (dropdown de
usuario) pero no debe ser el único punto de control de acceso.

## Limitación conocida: verificación de audiencia deshabilitada

`ingestion-api` valida el JWT con `options={"verify_aud": False}` porque el client compartido del
realm `Apps` no tiene un audience mapper configurado — el `access_token` no incluye el claim `aud`
que el microservicio esperaría verificar. Firma, issuer y expiración sí se validan siempre. Un
despliegue real a producción debería agregar el audience mapper en Keycloak y reactivar esa
verificación (`app/core/security.py`, comentario inline documenta esto explícitamente).

## Gestión de secretos: HashiCorp Vault (KV v2)

Cada conector (GitLab, Google Drive, base de datos) referencia su credencial por **path**, nunca
por valor:

```
Connector.vault_secret_ref = "secrets/kb/gitlab"   # ← esto se guarda en el store de conectores
```

`ingestion-api` es el **único** proceso con permiso para leer el valor real del secreto
(`VaultClient.get_secret_value`), y solo lo hace server-side para autenticar contra el sistema
externo correspondiente (p. ej. construir el header `PRIVATE-TOKEN` para llamar a la API de
GitLab) — ese valor **nunca** se serializa en una respuesta HTTP hacia el frontend. La UI de
"Credenciales (Vault)" solo puede ver/gestionar **metadata** (path, versión, fecha de
actualización) vía `VaultClient.get_secret_metadata`/`list_secrets`.

Construcción de URL KV v2 (`vault_client.py`): `KM_VAULT_KV_PATH` (p. ej. `secret/kb`) se separa en
`mount` (`secret`) + `prefix` (`kb`); las URLs finales son `/v1/<mount>/data/<prefix>/<path>` y
`/v1/<mount>/metadata/<prefix>/<path>` — este detalle importa porque el mount real de Vault no
siempre coincide con lo que un mock/ejemplo sugiere; confirmarlo contra el servidor Vault real
(`vault secrets list`) antes de asumirlo.

## Contrato de errores (ambos sistemas)

Ninguna respuesta de error, en ningún sistema, debe incluir: tokens, secretos, SQL crudo, o
contenido de documentos. El Portal usa `HTTPException(503, detail=...)` para fallos de
dependencias externas (Vault, GitLab) en vez de dejar pasar un 500 crudo con detalle interno.
