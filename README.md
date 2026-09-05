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

## I2 opt-in runtime

I2 adds optional MySQL persistence, Keycloak/JWKS bearer authentication, aggregate audit persistence, and authenticated Streamable HTTP. The default configuration remains offline and in-memory.

For local HTTP contract testing only:

```bash
KCP_HTTP_ENABLED=true KCP_HTTP_LOCAL_MODE=true npm run dev
```

For a MySQL-backed run, copy `.env.i2.example`, set `KCP_MYSQL_ENABLED=true` and `KCP_MYSQL_URL`, then start the local MySQL service with `docker compose -f docker-compose.i2.yml up -d`. Production HTTP mode requires `KCP_KEYCLOAK_ISSUER` and `KCP_KEYCLOAK_AUDIENCE`; local mode must not be enabled in production.

The liveness endpoint is `GET /health`, readiness is `GET /ready`, and the MCP endpoint is `POST /mcp`. HTTP requests require `Authorization: Bearer <token>` unless local mode is explicitly enabled. Error responses never include tokens, SQL, prompts, or document content.

I2 does not implement Qdrant, embeddings, hybrid semantic retrieval, Vault runtime calls, Kubernetes deployment, portal ingestion, source connectors, mutation tools, or web UI.

## I3 opt-in ingestion and hybrid retrieval

I3 adds filesystem document ingestion, deterministic canonicalization/chunking, configurable embeddings, Qdrant vectors, MySQL index state, ACL-aware hybrid retrieval, and idempotent reindexing. It requires MySQL and Qdrant; `local-test` is available for deterministic local checks. See `docs/operations/i3-indexing.md` and `docs/manual-tests/i3-hybrid-retrieval.md`.

See `docs/operations/i1-local-development.md` for setup and operating details.

```
$env:NODE_USE_SYSTEM_CA='1'; rtk npm ci
npx @modelcontextprotocol/inspector npm run dev -- --stdio
```
