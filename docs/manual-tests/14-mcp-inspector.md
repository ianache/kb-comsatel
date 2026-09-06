# Caso manual I5-D — validación con MCP Inspector

## Objetivo

Verificar manualmente el contrato MCP STDIO y reproducir mediante MCP Inspector cuatro de los seis casos que presentaron timeout en la ejecución completa de Vitest.

Los casos I5D-TMO-01 —indexación I5-B— e I5D-TMO-06 —health server— no se ejecutan con MCP Inspector porque no son operaciones MCP. Deben validarse con sus pruebas Vitest correspondientes.

## Preparación

Desde la raíz del worktree I5-D:

```powershell
npm run build
npx @modelcontextprotocol/inspector node dist/server.js --stdio
```

Abrir la URL mostrada por el comando y pulsar `Connect`.

## I5D-MCP-01 — descubrimiento del contrato

En `Tools`, verificar estas siete herramientas:

```text
build_context_pack
get_artifact_lineage
get_knowledge_excerpt
get_provenance
get_task_context
list_stale_concepts
search_knowledge
```

En `Resources`, verificar estos tres templates:

```text
km://artifact/{knowledge_id}
km://artifact/{knowledge_id}/version/{revision}
km://taxonomy/{domain}
```

Resultado esperado: las siete tools aparecen como operaciones de solo lectura y se muestran los tres templates.

## I5D-MCP-02 — búsqueda con evidencia citada

En `Tools > search_knowledge`, enviar:

```json
{
  "query": "premium unit",
  "limit": 8
}
```

Resultado esperado:

- `evidenceStatus` es `sufficient`.
- Existe al menos un resultado con cita.
- La primera cita usa `knowledgeId: artifact-public-unit-rule`.
- No aparece contenido sin cita.

## I5D-MCP-03 — entrada inválida segura

En `Tools > search_knowledge`, enviar:

```json
{
  "query": "premium unit",
  "limit": 21
}
```

Resultado esperado:

```json
{
  "error": {
    "code": "INVALID_INPUT",
    "message": "Invalid search_knowledge input"
  }
}
```

No deben aparecer stack traces, tokens, JWT ni secretos.

## I5D-MCP-04 — recurso inválido seguro

En `Resources`, leer la URI:

```text
km://taxonomy/%20
```

Resultado esperado:

```json
{
  "error": {
    "code": "INVALID_INPUT",
    "message": "Invalid taxonomy resource input"
  }
}
```

## Evidencia

Registrar:

- fecha y hora;
- commit probado (`git rev-parse HEAD`);
- captura o exportación sanitizada del Inspector;
- respuesta de cada operación;
- ausencia de secretos y stack traces.

## Validación complementaria fuera del Inspector

```powershell
npx vitest run --testTimeout=15000 tests/ingestion/i5b-indexing.test.ts -t "compiles, writes and indexes a valid stable corpus in order"
npx vitest run --testTimeout=15000 tests/ops/health-server.test.ts -t "returns a healthy response"
```

Resultado esperado en ambos casos: `1 passed`, `0 failed` y ausencia de `Test timed out`.
