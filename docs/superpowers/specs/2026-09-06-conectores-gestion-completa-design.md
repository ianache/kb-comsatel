# Gestión completa de Conectores y Fuentes — Diseño

**Fecha:** 2026-09-06
**Estado:** Aprobado para implementación

## Contexto

`portal/micro-ui-ingesta` tiene hoy una pantalla "Conectores y fuentes" con grid de tarjetas
y un diálogo de creación centrado. El diseño Claude Design ("Portal KM Comsatel.dc.html",
actualizado 2026-09-06) especifica funcionalidad que aún no existe en el código:

1. Sección "Detalle operacional / GitLab Enterprise Server": tabla de repos vinculados con
   filtro y botón "Vincular nuevo repo".
2. Botón "Configurar" (sin comportamiento en el mockup, en las 4 tarjetas de conector).
3. Acción primaria por tipo: GitLab → "Administrar repositorios" (pantalla dedicada
   `showManageRepos` en el mockup, totalmente especificada); Google Drive → "Seleccionar
   carpetas" (el mockup la deja apuntando a la pantalla compartida "Selección de fuentes",
   pero por decisión de producto se implementa como pantalla dedicada análoga a GitLab, no
   compartida); Base de datos → "Esquemas mapeados" (sin comportamiento en el mockup).
4. Diálogo "Nuevo conector" migrado al panel lateral (slide-over) que especifica el mockup
   actualizado: campos Nombre + Descripción + campos condicionales por tipo (URL+Vault PAT
   para GitLab, Vault service account para Drive, Vault credentials para BD), botón
   "Verificar conectividad" (simulado, sin backend real de test), tipos limitados a
   gitlab/gdrive/db (sin upload/schema en el formulario de creación).

## Alcance

Backend (`ingestion-api`), proxy BFF, y frontend (`micro-ui-ingesta`). Rol `km-admin`
gatea toda escritura, igual que la creación de conectores ya implementada.

Fuera de alcance: conectividad real a GitLab/Drive/DB (todo sigue siendo datos sembrados
in-memory, consistente con el resto del scaffold); tipos "upload"/"schema" en el flujo de
creación (siguen existiendo como `ConnectorKind` pero no son seleccionables al crear, igual
que el mockup).

## Modelo de datos (backend)

Nuevos modelos en `app/models/schemas.py`:

```python
class GitLabRepoLink(BaseModel):
    id: str
    connector_id: str
    repo: str          # "namespace/nombre"
    repo_id: str        # id del catálogo GitLab
    rama: str
    ruta: str = "/"
    auto_sync: bool = True
    estado: str = "Sincronizado"  # "Sincronizado" | "Pausado"

class GitLabCatalogEntry(BaseModel):
    id: str
    nombre: str
    grupo: str
    rama_default: str
    ramas_disponibles: list[str]

class DriveFolderLink(BaseModel):
    id: str
    connector_id: str
    path: str
    tipo: str  # "Carpeta compartida" | "Restringida"

class DriveCatalogEntry(BaseModel):
    id: str
    path: str
    tipo: str

class SchemaTable(BaseModel):
    id: str
    connector_id: str
    tabla: str
    columnas: int
    motor: str  # "PostgreSQL" | "MySQL" | "MongoDB"

class UpdateConnectorRequest(BaseModel):
    name: str | None = None
    base_uri: str | None = None
    vault_secret_ref: str | None = None
    active: bool | None = None
```

`Connector` y `CreateConnectorRequest` ganan `descripcion: str = ""`.

Stores in-memory nuevos en `app/db/session.py`, sembrados con datos de ejemplo análogos a
los del mockup (catálogo GitLab de ~9 repos, catálogo Drive de ~5 carpetas, ~6 tablas de
esquema), con funciones `list_/create_/get_` siguiendo el patrón ya usado para batches y
connectors.

## Endpoints (backend)

Todos bajo `/api/v1`, todos requieren bearer token válido; escritura requiere `km-admin`,
lectura los mismos roles que ya lee conectores (`km-admin`, `km-auditor`):

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/gitlab/catalog` | Catálogo completo de repos GitLab disponibles para vincular |
| `GET` | `/connectors/{id}/repos` | Repos ya vinculados a ese conector |
| `POST` | `/connectors/{id}/repos` | Vincula repos del catálogo (body: `{repo_ids: [...], branch_by_id: {...}}`) |
| `GET` | `/gdrive/catalog` | Catálogo de carpetas Drive disponibles |
| `GET` | `/connectors/{id}/folders` | Carpetas ya vinculadas |
| `POST` | `/connectors/{id}/folders` | Vincula carpetas del catálogo |
| `GET` | `/connectors/{id}/schemas` | Tablas/esquemas mapeados (solo lectura) |
| `PATCH` | `/connectors/{id}` | Edita nombre/base_uri/vault_secret_ref/active |

## BFF

Rutas espejo bajo `portal/bff/src/app/api/ingesta/connectors/[id]/repos/route.ts`,
`.../folders/route.ts`, `.../schemas/route.ts`, y `PATCH` agregado a
`connectors/[id]/route.ts` (nuevo, hoy no existe ruta con `[id]`), más
`portal/bff/src/app/api/ingesta/gitlab-catalog/route.ts` y `gdrive-catalog/route.ts`.
Mismo patrón que las rutas existentes: `getSession()`, 401 si no hay sesión, reenvío con
`Authorization: Bearer` al `INGESTION_API_URL`.

## Frontend (`micro-ui-ingesta`)

- `ingesta-api.service.ts`: métodos nuevos (`listGitlabRepos`, `linkGitlabRepos`,
  `listGitlabCatalog`, análogos para Drive, `listSchemas`, `updateConnector`) + interfaces.
- `conectores.component.ts`:
  - Sección "Detalle operacional / GitLab Enterprise Server" (tabla + filtro client-side +
    botón "Vincular nuevo repo" que navega a la pantalla de administrar repos), visible
    cuando existe un conector GitLab.
  - "Configurar" en cada tarjeta abre un panel lateral de edición (nuevo componente
    `editar-conector.component.ts`, reutilizado por los 4 tipos).
  - Botón primario por tipo enruta a la pantalla correspondiente (`routerLink`), excepto
    "Esquemas mapeados" que puede ser un panel inline o ruta — se implementa como ruta para
    consistencia con las otras dos.
- Nuevas rutas en `ingesta.routes.ts`:
  - `conectores/:id/repositorios` → `administrar-repositorios.component.ts` (catálogo +
    checkboxes + selector de rama + "Añadir seleccionados" + tabla de vinculados + volver).
  - `conectores/:id/carpetas` → `seleccionar-carpetas.component.ts` (mismo patrón,
    carpetas en vez de repos, sin selector de rama).
  - `conectores/:id/esquemas` → `esquemas-mapeados.component.ts` (tabla de solo lectura).
- `conectores.component.ts` (diálogo de creación): reemplazo del `.dialog` centrado actual
  por un panel lateral fijo (`position:fixed;inset:0;justify-content:flex-end`, panel de
  440px), con Descripción, tipos limitados a gitlab/gdrive/db vía `.seg`, campos
  condicionales por tipo, y "Verificar conectividad" que simula una validación con
  `setTimeout` (sin llamada real) mostrando un resultado en una card, igual que el mockup.

## Errores y estados vacíos

Mismo patrón ya establecido: mensajes "Sin X todavía" en listas vacías, error inline en el
panel activo (no toasts globales) usando el mismo manejo try/catch/finally que ya se usa en
`submit()` del diálogo de creación, para evitar el bug de "Guardando…" colgado que ya se
corrigió ahí.

## Testing

Manual end-to-end (curl a los endpoints nuevos con y sin rol `km-admin`, luego a través del
BFF, luego en el navegador) — el repo no tiene suite de tests para el portal todavía, fuera
de alcance de este cambio.
