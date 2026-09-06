# 10 - I5-B indexación OKF remoto desde GitLab

## Objetivo

Validar el flujo explícito GitLab read-only → compilador OKF → proyección → MySQL/Qdrant mediante I3. Solo los documentos `stable` llegan al índice estable.

## Precondiciones

1. Node.js 22, npm y el repositorio en una rama limpia.
2. Ejecutar `npm ci`, `npm run build` y `npm run typecheck`.
3. Para la prueba offline, no se requieren servicios externos.
4. Para la prueba autorizada, usar un token GitLab de lectura y un proyecto controlado con corpus OKF válido. Nunca guardar el token en evidencia.

## Casos offline

### I5B-INDEX-01 - aceptación GitLab fake

```powershell
npm test -- tests/ingestion/i5b-source-acceptance.test.ts tests/ingestion/i5b-indexing.test.ts
```

Esperado: el corpus estable se indexa; el corpus inválido no invoca I3; el resultado no contiene contenido documental ni credenciales.

### I5B-INDEX-02 - idempotencia y cambio de revisión

```powershell
npm test -- tests/ingestion/i5b-idempotence.test.ts tests/retrieval/ingestion-indexer.test.ts tests/retrieval/i3-acceptance.test.ts
```

Esperado: repetir la misma revisión produce `skipped`; una revisión nueva procesa el documento una vez; no se duplican vectores de la misma revisión.

### I5B-INDEX-03 - comando seguro por defecto

```powershell
npm run okf:source-index
```

Esperado: termina con código distinto de cero e informa que la fuente GitLab está deshabilitada. No realiza llamadas a GitLab, MySQL ni Qdrant.

## Caso GitLab autorizado

Configurar las variables en una sesión protegida. El comando nunca debe recibir el token como argumento.

```powershell
$env:KCP_GITLAB_SOURCE_ENABLED = "true"
$env:KCP_GITLAB_SOURCE_BASE_URL = "https://project.comsatel.com.pe"
$env:KCP_GITLAB_SOURCE_PROJECT_ID = "587"
$env:KCP_GITLAB_SOURCE_TOKEN = "<TOKEN_DE_LECTURA>"
$env:KCP_GITLAB_SOURCE_REF = "main"
$env:KCP_GITLAB_SOURCE_ROOT = "knowledge"
$env:KCP_GITLAB_SOURCE_TIMEOUT_MS = "60000"

$env:KCP_I3_ENABLED = "true"
$env:KCP_I3_QDRANT_ENABLED = "true"
$env:KCP_I3_EMBEDDING_MODEL = "local-test"
$env:KCP_MYSQL_ENABLED = "true"
$env:KCP_MYSQL_URL = "mysql://kcp:kcp-local-password@127.0.0.1:3307/knowledge_context"

npm run okf:source-index
npm run okf:source-index
```

Esperado:

- la primera ejecución devuelve `indexed`, revisión GitLab, `corpusHash` y conteos;
- la segunda ejecución devuelve documentos omitidos por idempotencia;
- solo los documentos `stable` aparecen en MySQL/Qdrant;
- la salida no contiene token ni cuerpo Markdown;
- GitLab no recibe POST, PUT, PATCH ni DELETE y no aparecen ramas, commits o Merge Requests nuevos.

## Cambio de revisión

Crear una nueva revisión del corpus en la rama controlada, manteniendo el mismo `knowledgeId` con contenido modificado, y repetir:

```powershell
npm run okf:source-index
```

Esperado: se indexa la nueva revisión, se conserva `sourceRevision` en la procedencia y no se crean duplicados activos.

## Evidencia y limpieza

Registrar código de salida, `projectId`, SHA, `corpusHash`, conteos y estado. No registrar token, headers ni contenido completo. Limpiar únicamente las variables temporales:

```powershell
Remove-Item Env:KCP_GITLAB_SOURCE_TOKEN -ErrorAction SilentlyContinue
Remove-Item Env:KCP_MYSQL_URL -ErrorAction SilentlyContinue
Remove-Item Env:KCP_GITLAB_SOURCE_ENABLED -ErrorAction SilentlyContinue
Remove-Item Env:KCP_GITLAB_SOURCE_BASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:KCP_GITLAB_SOURCE_PROJECT_ID -ErrorAction SilentlyContinue
Remove-Item Env:KCP_GITLAB_SOURCE_REF -ErrorAction SilentlyContinue
Remove-Item Env:KCP_GITLAB_SOURCE_ROOT -ErrorAction SilentlyContinue
Remove-Item Env:KCP_I3_ENABLED -ErrorAction SilentlyContinue
Remove-Item Env:KCP_I3_QDRANT_ENABLED -ErrorAction SilentlyContinue
Remove-Item Env:KCP_I3_EMBEDDING_MODEL -ErrorAction SilentlyContinue
Remove-Item Env:KCP_MYSQL_ENABLED -ErrorAction SilentlyContinue
```
