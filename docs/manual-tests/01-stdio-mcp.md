# 01 — STDIO e inventario MCP

## Objetivo

Confirmar que I2 no rompe el contrato I1: siete herramientas, tres templates de recursos, stdout reservado al protocolo y diagnósticos en stderr.

## Pasos

1. Ejecutar `npm run smoke`.
2. Ejecutar `npm run dev -- --stdio`.
3. Conectar un cliente MCP compatible o MCP Inspector al proceso STDIO.
4. Listar tools y resource templates.
5. Ejecutar `search_knowledge` con `premium unit`.
6. Ejecutar `get_knowledge_excerpt` y `get_provenance` con un ID existente.
7. Enviar una entrada inválida, por ejemplo `limit: 0`.

## Resultado esperado

- El smoke termina con `smoke discovered 7 tools and 3 resource templates`.
- Se descubren las siete tools I1 y los tres templates `km://artifact/{knowledge_id}`, `km://artifact/{knowledge_id}/version/{revision}` y `km://taxonomy/{domain}`.
- La búsqueda devuelve citas y `evidenceStatus`; nunca devuelve contenido sin cita.
- La entrada inválida devuelve `INVALID_INPUT` sin stack trace.
- No aparecen diagnósticos ni JSON ajeno al protocolo en stdout.

## Evidencia

Guardar la salida de `npm run smoke`, nombres descubiertos y una respuesta positiva/negativa sanitizada del cliente MCP.
