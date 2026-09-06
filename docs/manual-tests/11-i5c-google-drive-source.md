# 11 - I5-C ingesta read-only desde Google Drive

## Objetivo

Validar el flujo Google Drive → compilador OKF → proyección → I3 usando carpetas explícitas, token OAuth de lectura y sin realizar mutaciones en Drive.

## Precondiciones

1. Node.js 22 y npm disponibles desde la raíz del repositorio.
2. Ejecutar `npm ci`, `npm run build` y `npm run typecheck`.
3. Para pruebas offline no se requieren Google Drive, MySQL ni Qdrant.
4. Para la prueba autorizada, disponer de un token OAuth con permiso de lectura y una carpeta Drive controlada.

## Casos offline

### I5C-DRIVE-01 - contratos, paginación y seguridad

```powershell
npm test -- tests/ingestion/google-drive-contracts.test.ts tests/config-i5c.test.ts tests/ingestion/google-drive-adapter.test.ts tests/security/google-drive-sensitive-output.test.ts
```

Esperado: la lista paginada se ordena de forma determinista, se filtran archivos eliminados, solo se usan GET y no aparecen token ni cuerpo de error.

### I5C-DRIVE-02 - normalización y aceptación

```powershell
npm test -- tests/ingestion/google-drive-content.test.ts tests/ingestion/i5c-indexing.test.ts tests/ingestion/i5c-source-acceptance.test.ts
```

Esperado: Markdown OKF válido puede indexarse; solo `stable` llega a I3; PDF sin extractor se omite; el resultado no contiene contenido documental.

### I5C-DRIVE-03 - identidad e idempotencia

```powershell
npm test -- tests/ingestion/i5c-idempotence.test.ts tests/retrieval/ingestion-indexer.test.ts
```

Esperado: repetir el mismo `fileId + version + SHA-256` se omite; contenido cambiado produce una nueva revisión; no se duplican vectores de una misma revisión.

### I5C-DRIVE-04 - deshabilitado por defecto

```powershell
npm run okf:drive-validate
npm run okf:drive-index
```

Esperado: ambos comandos terminan con código distinto de cero sin configuración y no realizan llamadas a Drive, MySQL ni Qdrant.

## Caso autorizado contra Google Drive

Configurar solo en una sesión protegida y nunca registrar el token.

```powershell
$env:KCP_GOOGLE_DRIVE_SOURCE_ENABLED = "true"
$env:KCP_GOOGLE_DRIVE_BASE_URL = "https://www.googleapis.com/drive/v3"
$env:KCP_GOOGLE_DRIVE_FOLDER_IDS = "<FOLDER_ID_CONTROLADO>"
$env:KCP_GOOGLE_DRIVE_TOKEN = "<OAUTH_TOKEN_DE_LECTURA>"
$env:KCP_GOOGLE_DRIVE_TIMEOUT_MS = "60000"

$env:KCP_I3_ENABLED = "true"
$env:KCP_I3_QDRANT_ENABLED = "true"
$env:KCP_I3_EMBEDDING_MODEL = "local-test"
$env:KCP_MYSQL_ENABLED = "true"
$env:KCP_MYSQL_URL = "mysql://<usuario>:<password>@<host>:3306/<base>"

npm run okf:drive-validate
npm run okf:drive-index
npm run okf:drive-index
```

Esperado:

- `drive-validate` informa inventario/conteos sin escribir proyección estable;
- `drive-index` devuelve `sourceSystem=google-drive`, folder, revisión agregada, hash y conteos;
- la repetición es idempotente y omite revisiones ya indexadas;
- solo Markdown/PDF extraíble y documentos `stable` llegan al índice;
- no se envían POST, PUT, PATCH o DELETE a Drive;
- la salida no contiene token, Authorization, cuerpo de respuesta ni contenido completo.

## Cambio de contenido

Modificar un Markdown dentro de la carpeta controlada y conservar su `fileId`. Ejecutar nuevamente:

```powershell
npm run okf:drive-index
```

Esperado: el SHA-256 y la revisión efectiva cambian, se indexa la nueva versión y se conserva la procedencia Drive.

## Evidencia y limpieza

Registrar únicamente código de salida, folder, `fileId` sanitizado, revisión, SHA-256, conteos y estado. Limpiar las variables temporales al terminar:

```powershell
Remove-Item Env:KCP_GOOGLE_DRIVE_SOURCE_ENABLED -ErrorAction SilentlyContinue
Remove-Item Env:KCP_GOOGLE_DRIVE_BASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:KCP_GOOGLE_DRIVE_FOLDER_IDS -ErrorAction SilentlyContinue
Remove-Item Env:KCP_GOOGLE_DRIVE_TOKEN -ErrorAction SilentlyContinue
Remove-Item Env:KCP_GOOGLE_DRIVE_TIMEOUT_MS -ErrorAction SilentlyContinue
Remove-Item Env:KCP_I3_ENABLED -ErrorAction SilentlyContinue
Remove-Item Env:KCP_I3_QDRANT_ENABLED -ErrorAction SilentlyContinue
Remove-Item Env:KCP_I3_EMBEDDING_MODEL -ErrorAction SilentlyContinue
Remove-Item Env:KCP_MYSQL_ENABLED -ErrorAction SilentlyContinue
Remove-Item Env:KCP_MYSQL_URL -ErrorAction SilentlyContinue
```
