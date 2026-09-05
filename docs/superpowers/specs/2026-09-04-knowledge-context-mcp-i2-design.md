# Knowledge Context MCP I2 — Security and Persistent Catalog Design

**Status:** Approved in chat on 2026-09-04  
**Scope:** MCP server only; portal ingestion remains a separate initiative.

## Goal

Extend the completed I1 local MCP foundation with a persistent MySQL catalog, Keycloak/JWKS authentication and authorization, persistent aggregate audit events, and Streamable HTTP while preserving the existing MCP tool and resource contracts.

## Scope and non-goals

I2 includes:

- a MySQL-backed implementation of the existing `KnowledgeRepository` interface;
- JWT validation through Keycloak issuer metadata and JWKS;
- mapping authenticated claims to `AccessPrincipal` and enforcing ACL before candidate retrieval and before response serialization;
- persistent audit events containing aggregate metadata only;
- Streamable HTTP transport with authenticated MCP requests;
- migrations, configuration, unit tests, contract tests, and opt-in integration tests.

I2 does not include Qdrant, embeddings, hybrid or semantic retrieval, source connectors, Vault runtime integration, Kubernetes deployment, a web UI, portal ingestion, mutation tools, or changes to the public names and Zod contracts of the seven I1 tools and three resource templates.

## Architecture

The `ContextEngine` remains the policy boundary. MCP registration stays in `src/mcp`; infrastructure concerns are injected through replaceable interfaces:

- `MySqlKnowledgeRepository` implements `KnowledgeRepository` with parameterized queries and bounded result sets.
- `KeycloakPrincipalResolver` validates bearer tokens and returns `AccessPrincipal`.
- `PersistentAuditSink` implements the existing audit boundary and stores aggregate events without prompts, secrets, tokens, or full document text.
- `StreamableHttpAdapter` owns HTTP transport, authentication middleware, request correlation, and graceful shutdown.
- Existing in-memory repository, local principal, and in-memory audit sink remain available for offline tests and local stdio development.

The stdio entry point remains available for local development. HTTP authentication is mandatory unless an explicit non-production local mode is enabled. No credential is accepted in a query string.

## Request flow

1. The HTTP adapter receives a Streamable HTTP MCP request and creates or propagates a correlation ID.
2. Authentication middleware extracts the bearer token and invokes `KeycloakPrincipalResolver`.
3. The resolver validates issuer, audience, signature, expiration, `nbf`, and `azp`, using cached JWKS keys with refresh on an unknown key ID.
4. The MCP adapter validates the existing tool/resource input and invokes `ContextEngine` with the resolved principal.
5. The repository applies product, domain, classification, status, source, verification, stale, and ACL filters in the database query before returning candidates.
6. `ContextEngine` applies evidence, budget, citation, warning, and not-found policies.
7. The response is checked again for authorization-sensitive data before serialization.
8. `PersistentAuditSink` records operation, principal ID, filter keys, authorization result, evidence status, result count, latency, and correlation ID.

## MySQL catalog

Add versioned SQL migrations for these tables:

- `knowledge_artifacts`: immutable knowledge ID, product, domain, type, classification, current status, source system, successor ID, and timestamps;
- `knowledge_revisions`: artifact revision, title, source URI, content hash, validity dates, citation locators, and bounded excerpt metadata;
- `knowledge_excerpts`: citation-bearing excerpt text associated with an artifact revision;
- `knowledge_acl`: artifact ID plus principal, role, group, product, domain, and classification constraints;
- `knowledge_taxonomies`: product/domain taxonomy and concept lists;
- `knowledge_audit_events`: correlation ID, principal ID, operation, filter keys, result count, authorization, evidence status, latency, and timestamp.

Use foreign keys, indexes for the repository filter dimensions, UTC timestamps, bounded text columns, and parameterized SQL. The repository must return `null` for missing or unauthorized direct artifact lookups and must never expose ACL rows as content.

The database pool must be configurable, bounded, health-checkable, and closed during shutdown. Connection errors map to safe `INTERNAL_ERROR` responses and an audit event; SQL text and connection details are not returned to clients.

## Keycloak and authorization

Configuration supplies issuer URL, audience, accepted `azp` values, JWKS cache duration, clock tolerance, and claim mappings. The resolver must reject malformed, expired, not-yet-valid, wrong-issuer, wrong-audience, wrong-client, and unverifiable tokens.

Claim mapping produces the existing `AccessPrincipal` shape: stable ID, roles, groups, products, domains, and classifications. Empty or absent optional claims become empty arrays. ACL decisions are deny-by-default for HTTP and are evaluated before retrieval and before serialization. Direct resources use the existing safe not-found behavior.

The implementation uses `jose` and the standard OIDC discovery/JWKS endpoints. It does not call Keycloak admin APIs and does not persist tokens.

## Streamable HTTP and operations

Expose an authenticated MCP endpoint at `/mcp` using the official SDK Streamable HTTP transport. Keep `/health` and `/ready` on the operational listener and exclude them from MCP tool/resource discovery. Reject open CORS, unsupported methods, missing authorization, invalid content types, and oversized requests with safe structured errors.

Support graceful shutdown for the HTTP server, MCP sessions, MySQL pool, JWKS cache, and audit sink. Readiness is false until configuration, database connectivity, and required authentication metadata are initialized.

## Error and audit policy

Map authentication failures to a safe unauthorized response, authorization failures to `FORBIDDEN` or safe not-found according to the resource policy, validation failures to `INVALID_INPUT`, missing records to `NOT_FOUND`, and infrastructure failures to `INTERNAL_ERROR`. Never return stack traces, SQL, JWTs, secrets, raw prompts, complete document text, or complete claims.

Audit events contain only aggregate fields: `correlationId`, `principalId`, `operation`, `filterKeys`, `resultCount`, `authorization`, `evidenceStatus`, `latencyMs`, and timestamp. Tests must assert that forbidden sensitive fields cannot be serialized.

## Verification strategy

- Unit tests cover JWT claim validation, JWKS refresh, claim mapping, ACL decisions, safe errors, repository filtering, audit redaction, and shutdown.
- Repository tests use a deterministic fake database boundary; MySQL integration tests are opt-in and run against a disposable service.
- Migration tests apply the schema and verify indexes, foreign keys, seed fixtures, and rollback-safe startup behavior.
- MCP HTTP contract tests discover the same seven tools and three resource templates exposed by stdio, then exercise public, restricted, invalid, missing, and expired-token cases.
- Operational tests verify `/health`, `/ready`, correlation IDs, request limits, graceful shutdown, and readiness transitions.
- The local smoke path remains offline and uses in-memory adapters; the integration smoke path requires explicitly supplied MySQL and Keycloak endpoints.

## Rollout and compatibility

I1 remains the default local mode. New infrastructure adapters are selected through explicit configuration, and the public MCP contracts remain unchanged. The implementation plan must land migrations and interfaces before switching the composition root, so each task can be tested independently. Qdrant/I3 can later implement retrieval behind `KnowledgeRepository` without changing MCP registration or `ContextEngine` contracts.
