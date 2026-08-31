# I1 Local Development

## Setup

Use Node.js 22 and install dependencies from the lockfile:

```bash
npm ci
```

## Quality Gate

Run these exact commands before handing off changes:

```bash
npm run build
npm test
npm run typecheck
npm run format:check
```

For a single deterministic stdio check, run:

```bash
npm run smoke
```

`npm run smoke` builds the server, starts `dist/server.js --stdio`, initializes an MCP client, verifies the seven I1 tools and resource templates, and exits nonzero on failure. It does not require network services or credentials.

## Stdio Server

Start the development stdio server with:

```bash
npm run dev -- --stdio
```

MCP protocol output is written to stdout. Operational diagnostics, including readiness messages and startup failures, are written to stderr so clients can parse stdout as protocol traffic.

## Health Endpoints

The process binds the health server to the configured local host and port:

- `GET /health` reports liveness.
- `GET /ready` reports readiness after the seed catalog, context engine, and MCP server are initialized.

These endpoints are operational checks only; they are not MCP tools or resources.

## I1 Scope

I1 is a local, read-only MCP foundation backed by deterministic seed data. It does not support MySQL, Qdrant, Keycloak, Vault, Streamable HTTP, or hybrid semantic retrieval.
