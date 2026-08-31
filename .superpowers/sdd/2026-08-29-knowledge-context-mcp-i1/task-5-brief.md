# Task 5: Register MCP tools and resources over stdio

## Files

- Create `src/mcp/tools.ts`, `src/mcp/resources.ts`, `src/mcp/adapter.ts`, and `tests/mcp/stdio-contract.test.ts`.
- Modify `src/server.ts` to compose the MCP stdio entry point.

## Required interfaces

- Consume `ContextEngine` from Tasks 2–4 and the official `@modelcontextprotocol/sdk`.
- Export `createMcpServer(engine): McpServer`.
- Register exactly seven read-only tools: `search_knowledge`, `get_knowledge_excerpt`, `get_artifact_lineage`, `build_context_pack`, `get_task_context`, `get_provenance`, `list_stale_concepts`.
- Register exactly three resource templates: `km://artifact/{knowledge_id}`, `km://artifact/{knowledge_id}/version/{revision}`, and `km://taxonomy/{domain}`.
- Use Zod input validation and convert `KcpError` to safe MCP errors without stacks/secrets.
- Use `McpServer` and `StdioServerTransport`; stdout is MCP protocol only and diagnostics use stderr.
- `--stdio` creates config, seed repository, audit sink, engine, MCP server, and stdio transport.

## Required test

Spawn the compiled server with `node dist/server.js --stdio`, initialize an MCP client using `StdioClientTransport`, list tools/resources, call `search_knowledge` with a public seed query, assert results/citation/evidenceStatus, and assert invalid limit returns structured invalid-input error.

## Validation

Run `npm run build && npm test -- tests/mcp/stdio-contract.test.ts`, `npm run typecheck`, and `npm run format:check`. Write exact evidence to `.superpowers/sdd/2026-08-29-knowledge-context-mcp-i1/task-5-report.md`.

## Constraints

- Do not dispatch subagents or commit.
- Do not implement Streamable HTTP, MySQL, Qdrant, Keycloak, Vault, or mutation tools.
- Preserve Tasks 1–4 and unrelated files.
