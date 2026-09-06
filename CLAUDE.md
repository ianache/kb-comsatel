# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Git worktrees for this repo are placed under `.worktrees/`.

## Portal KM Comsatel (`portal/`)

The Portal de Ingesta de Conocimiento (see `00-REQSPEC/REQSPEC_PRD_Portal_Ingesta_KM.md`) lives entirely under `portal/`, separate from the MCP server's `src/`. It follows a **Shell + MicroUI** architecture: an Angular shell host loads per-domain Angular MicroUI remotes at runtime via Webpack Module Federation; a Next.js **BFF** owns the OIDC Authorization Code + PKCE flow against Keycloak and proxies to Python **FastAPI** microservices, which validate the forwarded bearer token against Keycloak's JWKS. See `portal/README.md` for the full rationale (why BFF+PKCE instead of a browser-side OIDC client) and local run instructions for each piece:

- `portal/shell/` — Angular Module Federation host (layout + routing only, no business logic).
- `portal/micro-ui-ingesta/` — first Angular MicroUI remote (dashboard, conectores/fuentes); add new domains as sibling `portal/micro-ui-<dominio>/` apps.
- `portal/bff/` — Next.js BFF; `/api/auth/{login,callback,logout,session}` implement PKCE and the encrypted session cookie, `/api/ingesta/*` proxy to the FastAPI services with the access token injected server-side.
- `portal/services/ingestion-api/` — first FastAPI microservice; add new domains as sibling `portal/services/<dominio>-api/` apps.
- `portal/shared/design-tokens/comsatel-tokens.css` — design tokens shared by shell and MicroUI, sourced from the Claude Design project "Portal KM Comsatel".

## Commands

Local quality gate (run these exact commands, in order, before considering work done):

```bash
npm ci
npm run build
npm test
npm run typecheck
npm run format:check
```

- Single test file: `npx vitest run tests/path/to/file.test.ts`
- Single test by name: `npx vitest run tests/path/to/file.test.ts -t "test name"`
- Watch mode: `npx vitest`
- Format fix (not just check): `npm run format`
- Deterministic offline smoke check (builds, starts stdio server, verifies MCP tool/resource discovery): `npm run smoke`
- Run the stdio server for local MCP clients: `npm run dev -- --stdio`
- I3 filesystem ingestion CLI: `npm run i3:index -- --source-dir <dir>`
- OKF corpus validate/compile/index: `npm run okf:validate`, `npm run okf:compile`, `npm run okf:index` (source-specific variants: `okf:source-*` for GitLab, `okf:drive-*` for Google Drive)
- Golden evaluation run: `npm run eval:golden`

## Architecture

This is an MCP (Model Context Protocol) server exposing a read-only knowledge catalog, built up in staged capability tiers (I1 → I5b) that are individually opt-in via env vars — the default configuration is offline, in-memory, and unauthenticated.

**Entry points**: `src/server.ts` boots the process; `src/config.ts` (`loadConfig()`) is the single source of runtime configuration and gates which optional subsystems (MySQL, Keycloak/JWKS auth, OpenTelemetry, I3 retrieval) are active.

**Layering** (by directory under `src/`):
- `mcp/` — the protocol surface: `tools.ts` and `resources.ts` define the MCP tool/resource contracts, `adapter.ts` wires them to the engine, `http-server.ts`/`http-auth.ts`/`http-errors.ts` implement the optional authenticated Streamable HTTP transport (stdio is the default transport and always available).
- `engine/` — `ContextEngine` (`context-engine.ts`) is the core orchestrator that MCP tool handlers call into; `audit.ts`/`mysql-audit-sink.ts` handle aggregate audit persistence.
- `catalog/` — the knowledge repository abstraction (`repository.ts`) with three interchangeable implementations: `memory-repository.ts` (default, seeded from `seed.ts`), `mysql-repository.ts` (I2 opt-in persistence), and `hybrid-repository.ts` (I3, combines catalog metadata with vector retrieval).
- `retrieval/` — I3 hybrid retrieval pipeline: `filesystem-document-source.ts` → `canonicalizer.ts` → `chunker.ts` → `embedding-provider.ts` (with `deterministic-embedding-provider.ts` for offline/test use and `http-embedding-provider.ts` for real embeddings) → `qdrant-vector-store.ts`, fused with catalog results via `score-fusion.ts`. `ingestion-indexer.ts` and `i3-runtime.ts` drive the `i3:index` CLI.
- `ingestion/` — source adapters that feed the OKF pipeline: `source-port.ts` is the interface, with `gitlab-http-source-adapter.ts`/`fake-gitlab-source-adapter.ts` and `google-drive-http-adapter.ts`/`fake-google-drive-source.ts` as real/fake pairs (fakes are used in tests and offline dev, not just for unit tests in isolation — check call sites before assuming a "fake" is test-only).
- `okf/` — the "Open Knowledge Format" corpus pipeline: `corpus-reader.ts` + `frontmatter-parser.ts` read source documents, `okf-schema.ts`/`okf-types.ts` validate them, `compiler.ts` (`compileOkfCorpus()`) compiles them into catalog-ready artifacts, `projection-writer.ts` writes projections, `governance.ts` enforces publication rules.
- `publication/` — pushes compiled OKF output back out to GitLab (`gitlab-port.ts`, `gitlab-http-adapter.ts`/`fake-gitlab-adapter.ts`, `publication-plan.ts`, `publication-service.ts`).
- `security/` — principal resolution for authenticated HTTP mode: `principal-resolver.ts` is the interface, `keycloak-principal-resolver.ts` + `oidc-discovery.ts` implement JWKS/OIDC validation against Keycloak.
- `ops/` — cross-cutting operational concerns: `health-server.ts` (`/health`, `/ready`), `structured-logger.ts` (pino-based, stderr-only), `otel.ts`/`observability-context.ts`/`observability-types.ts` (optional OpenTelemetry export), `metrics-registry.ts`, `runtime-dependencies.ts` (composition root that assembles which repository/auth/observability implementations to use based on config).
- `domain/` — shared types and error hierarchy (`errors.ts`, `schemas.ts`, `i3-types.ts`) used across layers.
- `evaluation/` — golden-dataset regression harness for retrieval/context quality (`golden-cli.ts`, `golden-runner.ts`, `golden-dataset.ts`, `golden-report.ts`).

**Tests** under `tests/` mirror the `src/` layout by directory, plus `tests/integration/` for end-to-end stdio/HTTP flows and `tests/fixtures/` for golden and OKF sample data.

### Stdio/HTTP transport contract

- MCP protocol messages use stdout exclusively; all operational diagnostics and readiness messages go to stderr. Never write non-protocol output to stdout in the stdio transport path.
- The I1 stdio server exposes seven read-only tools (`search_knowledge`, `get_knowledge_excerpt`, `get_artifact_lineage`, `build_context_pack`, `get_task_context`, `get_provenance`, `list_stale_concepts`) and resource templates for artifacts, artifact revisions, and taxonomy domains — `npm run smoke` asserts this exact surface.
- HTTP mode (`KCP_HTTP_ENABLED=true`) requires `Authorization: Bearer <token>` unless `KCP_HTTP_LOCAL_MODE=true` is explicitly set for local contract testing; local mode must never be enabled in production. Production HTTP requires `KCP_KEYCLOAK_ISSUER` and `KCP_KEYCLOAK_AUDIENCE`.
- Error responses must never include tokens, SQL, prompts, or document content.

### Opt-in tiers

- **I2**: MySQL persistence, Keycloak/JWKS auth, aggregate audit persistence, authenticated Streamable HTTP. Enable via `KCP_MYSQL_ENABLED=true` + `KCP_MYSQL_URL`; local MySQL via `docker-compose.i2.yml`.
- **I3**: filesystem ingestion, deterministic chunking/embeddings, Qdrant vectors, MySQL index state, hybrid retrieval. Enable via `KCP_I3_ENABLED=true`; requires MySQL and Qdrant (`docker-compose.i3.yml`), or `local-test` mode for deterministic local checks. See `docs/operations/i3-indexing.md` and `docs/manual-tests/i3-hybrid-retrieval.md`.
- I2 alone does not implement Qdrant, embeddings, hybrid semantic retrieval, Vault runtime calls, Kubernetes deployment, portal ingestion, source connectors, mutation tools, or a web UI — those land in I3+.

See `docs/operations/i1-local-development.md` for full setup/operating details, and `00-REQSPEC/` for the requirements spec driving each tier.

## Repo-specific workflow requirement

Per `AGENTS.md`, this workspace requires running Graphify (`/graphify .`) before non-trivial inspection, analysis, edits, review, or debugging work, using `graphify-out/` as primary context. Use `/graphify . --update` to refresh an existing graph after code changes. Skip only when the task genuinely doesn't need workspace context, and say so explicitly.

### Graphify usage

- Trigger: `/graphify` invokes the `graphify` skill — do this before answering, analyzing, or editing anything in this workspace (mandated by `AGENTS.md`, not optional for "small" tasks).
- Full rebuild: `/graphify .` from the repo root. Incremental refresh after code/doc changes: `/graphify . --update` (no LLM cost).
- Output lives in `graphify-out/`: `graph.html` (interactive graph), `graph.json` (raw nodes/edges), `manifest.json`, `GRAPH_REPORT.md` (community hubs, god nodes, corpus stats), and `cache/`.
- Before trusting `graphify-out/`, check staleness: `GRAPH_REPORT.md` records the commit it was built from (`Built from commit:`) — compare against `git rev-parse HEAD` and re-run `--update` if it's behind.
- Use `GRAPH_REPORT.md`'s "God Nodes" section (e.g. `ContextEngine`, `MemoryKnowledgeRepository`, `loadConfig()`, `compileOkfCorpus()`) as an entry point for orientation on unfamiliar parts of the codebase, and the community list to jump to a topic cluster rather than grepping cold.
- If the `graphify` command/package is unavailable, install it locally into `.venv` per `AGENTS.md`'s fallback instructions (do not rely on a global install) and report the exact error if installation fails — never claim Graphify ran when it didn't.

### Knowledge base content (OKF v0.2 frontmatter)

The catalog's source content is authored as Markdown files with YAML frontmatter conforming to Google's Open Knowledge Format (OKF) v0.2, validated by `src/okf/okf-schema.ts` (`okfDocumentSchema`) and parsed by `src/okf/frontmatter-parser.ts`. `compileOkfCorpus()` (`src/okf/compiler.ts`) turns a directory of these files into catalog-ready artifacts consumed by `search_knowledge`/`build_context_pack`/etc.

Required/known frontmatter fields (strict schema — unknown keys are rejected):

| Field | Notes |
|---|---|
| `knowledgeId` | Stable identifier for the artifact across revisions. |
| `title`, `artifactType` | Human title and artifact kind (e.g. `note`, `rule`). |
| `sourceUri`, `sourceRevision` | Provenance back to the originating system/document. |
| `product`, `domain` | Taxonomy fields used for filtering and `km://taxonomy/{domain}` resources. |
| `classification` | Sensitivity label, consumed by ACL/audit logic. |
| `status` | One of `stable`, `draft`, `stale`, `deprecated`, `superseded`, `archived` — drives `list_stale_concepts` and freshness checks. |
| `owner` | Accountable owner string. |
| `evidence` | Array of supporting evidence references (defaults to `[]`). |
| `verifiedAt`, `staleAfter` | ISO timestamps controlling staleness computation (optional). |
| `locator` | Optional `sectionPath` / `pageRange` / `lineRange` pinpointing the excerpt within the source. |
| `acl` | Optional `principalIds` / `roles` / `groups` / `products` / `domains` / `classifications` arrays gating access (all default to `[]`). |
| `relations` | Optional `supersededBy` and `relatedTo` (array) links between artifacts. |

The Markdown body after the frontmatter becomes `content`. See `tests/fixtures/okf-valid/*.md` (e.g. `draft.md`, `rule.md`) for minimal valid examples and `tests/fixtures/okf-invalid/*.md` for rejected shapes (e.g. duplicate `knowledgeId`s). Validate/compile a corpus with `npm run okf:validate` / `npm run okf:compile` before indexing (`npm run okf:index`); GitLab- and Google-Drive-sourced corpora use the `okf:source-*` / `okf:drive-*` variants respectively.

When authoring or editing knowledge content in this repo, keep frontmatter strictly within this schema (extra fields fail `.strict()` validation), keep `status`/`verifiedAt`/`staleAfter` accurate since they drive staleness tooling, and re-run Graphify after adding or changing knowledge files so the graph reflects the new content.
