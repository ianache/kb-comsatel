# Integración HashiCorp Vault — Credenciales — Diseño

**Fecha:** 2026-09-06
**Estado:** Aprobado para implementación

## Contexto

El scaffold ya almacena `vault_secret_ref` (referencias a paths de Vault) en conectores,
pero no existe integración real con un servidor Vault ni una pantalla para administrar
credenciales. El diseño Claude Design actualizado agrega al sidebar la opción
"Credenciales (Vault)" con una página de administración.

## Alcance

Backend (`ingestion-api`), proxy BFF, frontend (shell + micro-ui-ingesta). Motor KV v2 de
Vault. Servidor por defecto `http://192.168.100.205:8200` (parametrizable). Todo gateado a
`km-admin`. **Nunca se expone el valor de un secreto ya guardado** al frontend — ni en
lectura ni tras escritura — solo metadata (path, versión, fecha).

Fuera de alcance: autenticación dinámica contra Vault (AppRole, etc.) — se usa un token
estático de variable de entorno, consistente con el resto del scaffold (sin gestión de
credenciales rotativas). UI para revelar valores (decisión explícita: nunca).

## Configuración (env vars, `ingestion-api`)

| Variable | Default | Notas |
|---|---|---|
| `KM_VAULT_ADDR` | `http://192.168.100.205:8200` | URL base del servidor Vault |
| `KM_VAULT_TOKEN` | *(sin default, requerido)* | Token de acceso a Vault |
| `KM_VAULT_KV_PATH` | `secrets/kb` | Prefijo del motor KV v2 donde viven las credenciales |

Si `KM_VAULT_TOKEN` no está configurado, los endpoints devuelven `503` con un mensaje claro
en vez de fallar de forma confusa — mismo patrón que otros servicios opcionales del scaffold
(igual que Keycloak/JWKS ya maneja fallos de red con un error explícito).

## Backend

`app/core/vault_client.py` — cliente HTTP delgado sobre la API KV v2 (`httpx`):
- `GET {addr}/v1/{kv_path}/metadata/{subpath}?list=true` → `list_secrets(subpath="")`
- `GET {addr}/v1/{kv_path}/metadata/{path}` → `get_secret_metadata(path)` (versión, fecha —
  nunca el body de `data/`)
- `POST {addr}/v1/{kv_path}/data/{path}` con `{"data": {...}}` → `write_secret(path, data)`
- `DELETE {addr}/v1/{kv_path}/metadata/{path}` → `delete_secret(path)` (borrado total,
  incluye todas las versiones — más simple que soft-delete para este scaffold)

Todas las llamadas envían header `X-Vault-Token: {KM_VAULT_TOKEN}`.

`app/api/routes_vault.py`, todas gateadas a `km-admin`:

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/v1/vault/secrets` | Lista paths bajo `KM_VAULT_KV_PATH` |
| `GET` | `/api/v1/vault/secrets/{path}/metadata` | Metadata de un secreto (sin valor) |
| `PUT` | `/api/v1/vault/secrets/{path}` | Crea/sobrescribe (body: pares clave/valor) |
| `DELETE` | `/api/v1/vault/secrets/{path}` | Elimina un secreto |

`{path}` es un segmento de ruta simple (sin `/` anidados) para este alcance — subpaths
anidados quedan fuera de alcance.

## BFF

Rutas proxy espejo bajo `portal/bff/src/app/api/ingesta/vault/secrets/route.ts` (GET) y
`portal/bff/src/app/api/ingesta/vault/secrets/[path]/route.ts` (GET metadata vía query
`?metadata=1` o subruta `/metadata`, PUT, DELETE), mismo patrón bearer-forwarding que las
rutas de conectores ya implementadas. Agregado a la lista de rutas cubiertas por CORS en
`middleware.ts` (el matcher `/api/ingesta/:path*` ya las cubre — sin cambios ahí).

## Frontend

- `portal/shell/src/app/app.component.ts`: nuevo `<a routerLink="/ingesta/vault">` en el
  nav, "Credenciales (Vault)".
- `portal/micro-ui-ingesta/src/app/ingesta.routes.ts`: nueva ruta `vault` →
  `vault-credenciales.component.ts`.
- Nuevo componente: tabla de paths (path, versión, última modificación), botón
  "+ Nueva credencial" que abre un panel lateral (mismo patrón `.dialog`/slide-over que
  conectores) con campo de path y pares clave/valor dinámicos (agregar/quitar filas). Al
  editar un path existente, los campos de valor empiezan vacíos (nunca se precargan) —
  guardar sobrescribe todas las claves enviadas. Botón eliminar con `confirm()` nativo del
  navegador (sin modal propio, dado el bajo riesgo de este scaffold de desarrollo).

## Errores y estados vacíos

Si el backend devuelve 503 (Vault no configurado o inalcanzable), la pantalla muestra un
mensaje claro ("Vault no está configurado o no es alcanzable") en vez de una tabla vacía
silenciosa — distingue "sin secretos" de "Vault no responde".

## Testing

Manual: verificar que sin `KM_VAULT_TOKEN` los endpoints devuelven 503 (no 500 ni 404);
con el servidor real accesible, listar/crear/eliminar un secreto de prueba y confirmar que
el valor nunca aparece en ninguna respuesta JSON devuelta al frontend. Si
`192.168.100.205:8200` no es alcanzable desde el entorno de desarrollo actual, documentarlo
como limitación conocida — el comportamiento 503/error de conexión es igualmente
verificable sin el servidor real.
