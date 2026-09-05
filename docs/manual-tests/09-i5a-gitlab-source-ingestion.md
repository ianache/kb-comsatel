# 09 - I5-A ingesta OKF desde GitLab en modo solo lectura

## Objetivo

Validar que el compilador OKF puede leer un repositorio GitLab remoto, resolver una revisión inmutable y compilar únicamente archivos Markdown, sin crear ramas, commits, Merge Requests ni modificar el repositorio origen.

## Precondiciones

1. Node.js 22 y npm disponibles desde la raíz del repositorio.
2. Ejecutar `npm ci`, `npm run typecheck` y las pruebas enfocadas.
3. Tener un proyecto GitLab autorizado con una rama existente y un token de lectura. No registrar el token en evidencia.
4. El repositorio remoto debe contener al menos un Markdown OKF bajo `knowledge/`.

## Casos offline

### I5A-SOURCE-01 - contratos y adaptadores fake

```powershell
npm test -- tests/ingestion/source-contracts.test.ts tests/ingestion/source-adapters.test.ts
```

Esperado: todas las pruebas pasan; el fake resuelve revisión, lista blobs y devuelve `sourceUri/sourceRevision`; no se ejecutan llamadas de red.

### I5A-SOURCE-02 - compilación remota con fake

```powershell
npm test -- tests/okf/remote-compiler.test.ts tests/okf/compiler.test.ts
```

Esperado: el corpus remoto válido compila, conserva su revisión GitLab y las reglas de gobernanza continúan bloqueando documentos inválidos.

### I5A-SOURCE-03 - selección explícita de fuente

```powershell
npm test -- tests/ingestion/okf-cli.test.ts
```

Esperado: la CLI acepta `--source local` y `--source gitlab`; la fuente local mantiene el comportamiento anterior.

## Caso GitLab autorizado

Configurar solo en una sesión protegida. Usar un token de mínimo privilegio (lectura de repositorio); nunca incluirlo en comandos capturados, logs o tickets.

```powershell
$env:KCP_GITLAB_SOURCE_ENABLED = "true"
$env:KCP_GITLAB_SOURCE_BASE_URL = "https://project.comsatel.com.pe"
$env:KCP_GITLAB_SOURCE_PROJECT_ID = "587"
$env:KCP_GITLAB_SOURCE_TOKEN = "<TOKEN_DE_LECTURA>"
$env:KCP_GITLAB_SOURCE_REF = "main"
$env:KCP_GITLAB_SOURCE_ROOT = "knowledge"
$env:KCP_GITLAB_SOURCE_TIMEOUT_MS = "60000"

npm run okf:source-validate
npm run okf:source-compile
```

Esperado:

- `validate` termina con código `0` para un corpus válido;
- `compile` genera el manifiesto y la proyección localmente;
- la evidencia contiene revisión, conteos y rutas, pero no token ni contenido completo;
- el proyecto GitLab no presenta ramas, commits ni Merge Requests nuevos;
- no se ejecuta I3/indexación automáticamente en I5-A.

## Casos de error

1. Con `KCP_GITLAB_SOURCE_ENABLED=false`, `--source gitlab` termina con error de fuente deshabilitada.
2. Con proyecto, rama o archivo inexistente, la CLI devuelve error sin filtrar el token ni el cuerpo de respuesta.
3. Ante un HTTP 401/403/5xx, la salida informa código/estado seguro y no imprime credenciales.

## Limpieza

```powershell
Remove-Item Env:KCP_GITLAB_SOURCE_ENABLED -ErrorAction SilentlyContinue
Remove-Item Env:KCP_GITLAB_SOURCE_BASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:KCP_GITLAB_SOURCE_PROJECT_ID -ErrorAction SilentlyContinue
Remove-Item Env:KCP_GITLAB_SOURCE_TOKEN -ErrorAction SilentlyContinue
Remove-Item Env:KCP_GITLAB_SOURCE_REF -ErrorAction SilentlyContinue
Remove-Item Env:KCP_GITLAB_SOURCE_ROOT -ErrorAction SilentlyContinue
Remove-Item Env:KCP_GITLAB_SOURCE_TIMEOUT_MS -ErrorAction SilentlyContinue
```
