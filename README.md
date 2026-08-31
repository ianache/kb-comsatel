# Knowledge Context MCP

Knowledge Context MCP is an I1 TypeScript MCP server that exposes a deterministic, read-only knowledge catalog over stdio. It includes local health endpoints for operations and uses an in-memory seed catalog for offline development.

## Requirements

- Node.js 22
- npm

## Local Commands

Run the local quality gate with these exact commands:

```bash
npm ci
npm run build
npm test
npm run typecheck
npm run format:check
```

Start the MCP stdio server for local clients:

```bash
npm run dev -- --stdio
```

Run the deterministic offline smoke check:

```bash
npm run smoke
```

The smoke script builds the server, starts the stdio process, initializes an MCP client, lists the seven I1 tools, verifies the resource templates, and exits nonzero if discovery fails.

## MCP Stdio Contract

- MCP protocol messages use stdout exclusively.
- Operational diagnostics and readiness messages use stderr.
- The I1 stdio server exposes these read-only tools: `search_knowledge`, `get_knowledge_excerpt`, `get_artifact_lineage`, `build_context_pack`, `get_task_context`, `get_provenance`, and `list_stale_concepts`.
- The I1 stdio server exposes resource templates for artifacts, artifact revisions, and taxonomy domains.

## Operations

The local process also starts health endpoints on the configured host and port:

- `GET /health` returns process liveness.
- `GET /ready` returns readiness after initialization.

I1 is intentionally offline and local. It does not include MySQL, Qdrant, Keycloak, Vault, Streamable HTTP, or hybrid semantic retrieval support.

See `docs/operations/i1-local-development.md` for setup and operating details.


```
$env:NODE_USE_SYSTEM_CA='1'; rtk npm ci
npx @modelcontextprotocol/inspector npm run dev -- --stdio
```