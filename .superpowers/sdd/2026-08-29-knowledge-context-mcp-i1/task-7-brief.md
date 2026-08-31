# Task 7: Add CI and developer documentation

## Files

- Create `.gitlab-ci.yml`, `README.md`, and `docs/operations/i1-local-development.md`.
- Modify `package.json` to add `npm run smoke`.

## Required behavior

- Document exact commands: `npm ci`, `npm run build`, `npm test`, `npm run typecheck`, `npm run format:check`, and `npm run dev -- --stdio`.
- Document MCP protocol on stdout and operational diagnostics on stderr.
- GitLab CI uses Node 22, `npm ci`, and separate test/typecheck/format/build jobs; fail on command errors and cache npm data using the lockfile.
- `npm run smoke` builds, starts stdio server, initializes MCP client, lists seven tools, and exits nonzero on failure; it is deterministic/offline.
- Do not claim I1 supports MySQL, Qdrant, Keycloak, Vault, Streamable HTTP, or hybrid semantic retrieval.

## Validation

Run `npm ci`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run smoke`. Write exact evidence to `.superpowers/sdd/2026-08-29-knowledge-context-mcp-i1/task-7-report.md`.

## Constraints

- Do not dispatch subagents or commit.
- Preserve implementation files and requirements documents.
