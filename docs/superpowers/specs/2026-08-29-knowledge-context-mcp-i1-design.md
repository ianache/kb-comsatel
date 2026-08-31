# Knowledge Context MCP I1 Design

**Date:** 2026-08-29  
**Status:** Approved in chat; written-spec review pending  
**Source requirements:** `00-REQSPEC/REQSPEC_PRD_Knowledge_Context_MCP.md`, `00-REQSPEC/KCP-ReqSpec-PRD.md`

## Goal

Deliver the I1 foundation of the Knowledge Context Platform as a runnable TypeScript/Node.js MCP server. The increment provides a real `stdio` MCP transport, validated read-only contracts, a reusable context engine, deterministic mock knowledge, health/readiness checks, contract tests, and GitLab CI validation.

## Scope

I1 includes:

- MCP tool and resource registration using the official TypeScript MCP SDK.
- `stdio` transport for local development.
- Seven read-only tools: `search_knowledge`, `get_knowledge_excerpt`, `get_artifact_lineage`, `build_context_pack`, `get_task_context`, `get_provenance`, and `list_stale_concepts`.
- Three read-only resources: `km://artifact/{knowledge_id}`, `km://artifact/{knowledge_id}/version/{revision}`, and `km://taxonomy/{domain}`.
- Zod validation for every tool input and output.
- A `KnowledgeRepository` interface with an in-memory implementation and seed data.
- A `ContextEngine` independent from MCP adapters.
- Evidence citations, explicit insufficient-evidence responses, status warnings, stale handling, and token-budget enforcement.
- Aggregated audit events that never store prompts, JWTs, secrets, or full document text.
- `/health` and `/ready` handlers exposed by a small operational HTTP server, separate from the MCP `stdio` channel.
- Unit tests, MCP contract tests over `stdio`, and CI commands for format/type/test checks.

I1 explicitly does not include MySQL, Qdrant, Keycloak, Vault, Streamable HTTP, Airflow, source connectors, a web UI, or content mutation tools. Their future integrations consume the interfaces established here.

## Architecture

```text
MCP client
  -> stdio adapter
  -> Zod input validation
  -> ContextEngine
  -> KnowledgeRepository
  -> citation/status/budget policy
  -> Zod output validation
  -> MCP response
```

The operational server is independent of MCP traffic:

```text
GET /health  -> process is alive
GET /ready   -> repository and engine are initialized
```

The engine receives an authenticated principal abstraction even though I1 uses a local allow-all mock principal. This keeps authorization policy out of MCP registration and makes I2's Keycloak/ACL adapter replaceable.

## Project structure

```text
src/
  config.ts
  server.ts
  domain/
    schemas.ts
    errors.ts
  catalog/
    repository.ts
    memory-repository.ts
    seed.ts
  engine/
    context-engine.ts
    audit.ts
  mcp/
    adapter.ts
    tools.ts
    resources.ts
  ops/
    health-server.ts
tests/
  domain/schemas.test.ts
  engine/context-engine.test.ts
  mcp/stdio-contract.test.ts
```

## Domain contracts

The implementation will model the PRD's `KnowledgeFilters`, `Citation`, `SearchKnowledgeInput`, and `SearchKnowledgeResult` with Zod schemas and inferred TypeScript types. I1 will use the exact enum values from the MCP PRD: `stable`, `draft`, `deprecated`, `superseded`, and `archived`; source systems are `gitlab`, `google-drive`, `okf`, and `schema-catalog`.

The repository interface will expose these operations:

```ts
interface KnowledgeRepository {
  search(input: SearchKnowledgeInput, principal: AccessPrincipal): Promise<SearchKnowledgeResult>;
  getExcerpt(knowledgeId: string, principal: AccessPrincipal): Promise<KnowledgeExcerpt | null>;
  getLineage(knowledgeId: string, principal: AccessPrincipal): Promise<ArtifactLineage | null>;
  getProvenance(knowledgeId: string, principal: AccessPrincipal): Promise<Provenance | null>;
  listStale(filters: KnowledgeFilters, principal: AccessPrincipal): Promise<StaleConcept[]>;
  getArtifact(knowledgeId: string, revision?: string, principal?: AccessPrincipal): Promise<KnowledgeArtifact | null>;
  getTaxonomy(domain: string, principal: AccessPrincipal): Promise<Taxonomy | null>;
}
```

`AccessPrincipal` contains an identity, roles, groups, products, domains, and classifications. The memory repository applies the same deny-by-default boundary expected from the future catalog and vector index, while seed data includes one public/stable artifact and one restricted artifact for negative authorization tests.

## Tool behavior

- `search_knowledge` validates `query` and `limit` (`1..20`, default `8`), filters candidates before ranking, returns citations for every result, and returns `evidenceStatus: insufficient` with no fabricated result when no authorized evidence matches.
- `get_knowledge_excerpt` returns only the requested bounded excerpt and its citation; it never returns a full source document.
- `get_artifact_lineage` returns source, revision, supersession, and validity information, including the successor for `superseded` artifacts.
- `build_context_pack` accepts `task`, `product`, `tokenBudget` (`500..12000`), and filters; it selects bounded excerpts without exceeding the budget and includes missing knowledge, conflicts, facts, decisions, related artifacts, and citations.
- `get_task_context` extracts searchable task identifiers from an Issue/MR-like input and delegates to the engine; it does not call GitLab in I1.
- `get_provenance` returns the content hash, canonical URI, source revision, attestation, and usage restrictions.
- `list_stale_concepts` returns only authorized artifacts whose `staleAfter` is before the evaluation time.

All seven tools are read-only. Errors are structured as MCP tool errors with stable error codes (`INVALID_INPUT`, `NOT_FOUND`, `FORBIDDEN`, `INSUFFICIENT_EVIDENCE`, and `INTERNAL_ERROR`) and no stack traces or sensitive values.

## Resource behavior

Resources resolve only authorized artifacts. Versioned resource URIs require an exact revision and return immutable metadata plus bounded content. Taxonomy resources return only the requested domain. Missing or unauthorized resources return the same externally safe `NOT_FOUND` shape to avoid metadata disclosure.

## Audit and safety

Each tool invocation emits an `AuditEvent` containing correlation ID, principal ID, tool name, normalized filter names, result count, authorization outcome, latency, and evidence status. It excludes raw query text, prompt bodies, JWTs, secrets, and complete excerpts. Document content is treated as untrusted data; no returned text is executed or interpreted as an instruction.

## Operational behavior

The process starts the MCP `stdio` server and the operational HTTP listener from one entry point. The HTTP listener binds to a configurable local host/port and exposes only `/health` and `/ready`. Readiness is false until the repository and engine have initialized. Configuration is environment-based with safe local defaults and no credentials.

## Testing and acceptance

Tests will verify:

1. Every schema rejects invalid limits, budgets, states, and malformed identifiers.
2. Search returns citations and `sufficient` evidence for an authorized stable seed artifact.
3. Unauthorized artifacts return no metadata or vector-like candidate.
4. Empty/unauthorized searches return `insufficient` without invented content.
5. Draft/deprecated/superseded results carry explicit warnings; superseded lineage exposes the successor.
6. Context packs stay within the requested token budget and preserve citations.
7. Resource URIs resolve consistently and deny unauthorized access.
8. The same MCP tool contract works through a spawned `stdio` client.
9. Health and readiness return the required operational states.
10. Audit events contain aggregate metadata only.

The local quality gate is `npm run format:check`, `npm run typecheck`, and `npm test`. CI runs the same commands on a supported Node.js LTS version.

## Future seams

I2 replaces `MemoryKnowledgeRepository` with a MySQL-backed catalog and adds Keycloak/JWKS authorization, Streamable HTTP, and persistent audit storage. I3 adds Qdrant retrieval behind the repository/engine boundary. I4 consumes approved OKF projections. None of those changes require changing MCP tool names or their public Zod contracts.
