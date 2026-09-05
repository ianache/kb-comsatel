# Prueba manual 1

## Objetivo

Verificar localmente el servidor Knowledge Context MCP, sus endpoints operativos y el contrato MCP I1.

## Prerrequisitos

- Node.js 22
- npm
- PowerShell

## Instalación y compilación

Desde la raíz del repositorio:

```powershell
$env:NODE_USE_SYSTEM_CA='1'; rtk npm ci
rtk npm run build
```

## Prueba del servidor

En la terminal 1, iniciar el servidor MCP:

```powershell
rtk npm run dev -- --stdio
```

El proceso debe mostrar un mensaje de disponibilidad `stdio ready` en `stderr`.

En la terminal 2, verificar los endpoints de salud:

```powershell
rtk curl.exe http://127.0.0.1:8787/health
rtk curl.exe http://127.0.0.1:8787/ready
```

Resultados esperados:

```json
{"status":"ok"}
{"status":"ready"}
```

## Prueba del contrato MCP

Ejecutar:

```powershell
rtk npm run smoke
```

Resultado esperado:

```text
smoke discovered 7 tools and 3 resource templates
```

Las herramientas esperadas son:

- `search_knowledge`
- `get_knowledge_excerpt`
- `get_artifact_lineage`
- `build_context_pack`
- `get_task_context`
- `get_provenance`
- `list_stale_concepts`

## Validación completa

```powershell
rtk npm test
rtk npm run typecheck
rtk npm run format:check
```

Todas las comprobaciones deben finalizar correctamente.
