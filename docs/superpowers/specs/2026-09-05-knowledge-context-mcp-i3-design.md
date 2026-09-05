# Knowledge Context MCP I3 — Hybrid Retrieval and Document Indexing Design

**Status:** Approved in chat on 2026-09-05  
**Scope:** Extend the I2 MCP server with opt-in document ingestion, embedding, Qdrant vector search, and hybrid retrieval while preserving the existing MCP contract.

## Goal

Add a reproducible ingestion and indexing pipeline plus hybrid lexical/vector retrieval without changing the seven public MCP tool names, the three resource templates, `ContextEngine` policy responsibilities, or I1/I2 offline behavior.

## Scope and non-goals

I3 includes:

- normalized document ingestion through a source boundary;
- deterministic canonicalization, content hashing, chunking, locator preservation, and idempotent re-indexing;
- a configurable embedding provider boundary with a generic HTTP-compatible production adapter and deterministic test adapter;
- a Qdrant vector-store adapter with collection validation, bounded queries, and safe payloads;
- MySQL metadata/chunk/index-state migrations;
- hybrid lexical/vector retrieval with deterministic score fusion and ACL enforcement;
- opt-in runtime composition, Docker Compose Qdrant support, integration smoke tests, and operational documentation.

I3 does not include live GitLab, Google Drive, or OKF connectors; portal ingestion; mutation MCP tools; document authoring; web UI; Qdrant clustering; reranking by an LLM; Vault runtime calls; Kubernetes deployment; or changes to the public Zod contracts.

The initial source adapter is a filesystem/manifest adapter suitable for local fixtures and controlled batch ingestion. External connectors can implement the same source interface in a later phase.

## Compatibility constraints

- `KnowledgeRepository` and `ContextEngine` remain the policy boundary.
- The seven tools and three resource URI templates remain byte-for-byte unchanged.
- I1 STDIO remains offline and uses the in-memory repository unless I3 is explicitly enabled.
- I2 HTTP authentication, ACL, safe errors, audit redaction, and readiness semantics remain mandatory.
- Qdrant and embedding credentials are never accepted in query strings and never logged.
- Search returns only citation-bearing excerpts hydrated from MySQL; Qdrant payloads never become public response content.
- Result limits remain bounded at 20 and context-pack token budgets remain enforced by `ContextEngine`.

## Architecture

I3 adds four replaceable boundaries:

- `DocumentSource`: reads source documents and emits normalized `SourceDocument` records;
- `EmbeddingProvider`: converts chunk text to fixed-dimension vectors and exposes its model/dimension identity;
- `VectorStore`: creates/validates a collection, upserts chunk vectors, deletes stale vectors, and performs filtered nearest-neighbor search;
- `IngestionIndexer`: orchestrates canonicalization, chunking, hashing, metadata persistence, embedding, vector upsert, and index-state transitions.

`HybridKnowledgeRepository` implements the existing `KnowledgeRepository` interface. It obtains lexical candidates from MySQL, obtains vector candidates from Qdrant using ACL-compatible payload filters, fuses scores deterministically, hydrates the winning chunk/artifact rows from MySQL, and performs a final authorization check before returning results.

The public request path is:

1. MCP validates the existing search input and supplies an authenticated `AccessPrincipal`.
2. `ContextEngine` invokes the repository and remains responsible for evidence status, warnings, citations, budgets, and audit metadata.
3. The repository runs bounded lexical and vector retrieval in parallel.
4. The vector query includes product/domain/classification/status/source and ACL-compatible payload filters.
5. MySQL hydration rechecks ACL and revision status before serialization.
6. Score fusion orders results by a deterministic weighted reciprocal-rank formula, with knowledge ID and chunk ID as stable tie-breakers.

The ingestion path is separate from MCP request handling. It is a controlled application service/CLI path and cannot be invoked through public MCP tools.

## Canonical documents and chunking

`SourceDocument` contains a stable source URI, source revision, title, source system, product, domain, classification, status, locator metadata, and canonical text. Canonicalization normalizes line endings, Unicode normalization, surrounding whitespace, and repeated blank lines before hashing.

Chunks use stable IDs derived from `knowledgeId`, `sourceRevision`, and ordinal. Each chunk stores bounded text, ordinal, token/character estimates, section/page/line locators, and the canonical content hash. Chunk boundaries are deterministic: target size and overlap come from configuration, headings are preferred boundaries, and no chunk exceeds the configured hard maximum.

Re-ingesting the same source revision is a no-op after hash comparison. A changed revision creates new chunk rows and vectors, marks prior revision vectors stale, and only publishes the new revision after all required vectors succeed. Partial failures leave an explicit failed index state and do not silently advertise the revision as searchable.

## MySQL and Qdrant data model

MySQL adds:

- `knowledge_chunks`: chunk ID, artifact/revision identity, ordinal, bounded text, content hash, locator fields, and timestamps;
- `knowledge_index_runs`: source revision, pipeline status, embedding model, vector dimension, counts, failure code, and timestamps;
- indexes for artifact/revision lookup, content hash, status, and lexical search.

Qdrant stores one point per searchable chunk. The payload contains only identifiers and filter dimensions: `chunk_id`, `knowledge_id`, `source_revision`, `product`, `domain`, `classification`, `status`, `source_system`, and verification/staleness flags. Full chunk text, prompts, JWTs, ACL arrays, and credentials are not stored in Qdrant payloads.

The collection name, vector dimension, distance metric, embedding model, and schema version are validated at startup. A dimension or model mismatch fails readiness rather than silently mixing incompatible vectors.

## Embeddings and retrieval

The production adapter uses a generic HTTP-compatible embeddings endpoint configured by URL, model, dimension, timeout, and secret from the environment. The interface supports batching and returns vectors in input order. A deterministic local provider is used for unit tests and offline smoke tests; it is not suitable for production relevance.

Lexical retrieval remains available as a fallback. Vector failure does not expose an error to callers when lexical candidates are available; the operation records a degraded retrieval warning through internal audit metadata. If both retrieval paths fail, the repository returns a safe `INTERNAL_ERROR` and no partial uncited content.

Fusion uses a configured vector/lexical weight and reciprocal-rank constant, normalizes missing paths, removes duplicate knowledge IDs, and selects at most the requested limit. Ranking must be deterministic for equal scores.

## Ingestion failure and security policy

- Source read, canonicalization, embedding, MySQL, and Qdrant failures map to safe internal errors for runtime requests.
- Failed ingestion runs record a bounded failure code and counts, never raw document text or credentials.
- ACL is applied to vector retrieval when payload filters can express it and always rechecked against MySQL before response serialization.
- Deleted or superseded revisions are removed from the active vector filter and remain available only through existing authorized lineage/provenance paths.
- Logs may include correlation ID, source system, revision ID, counts, latency, and failure code; they must not include full text, prompts, vectors, tokens, SQL, or secrets.

## Configuration and rollout

I3 is disabled by default. Enabling it requires explicit vector and ingestion settings, including Qdrant URL, collection, vector dimension, embedding endpoint/model, and an ingestion mode. Startup validates dependencies and collection compatibility before readiness becomes true.

Docker Compose adds Qdrant as an opt-in local service. MySQL remains the metadata system of record. Existing I2 local HTTP mode can use deterministic embeddings and local fixtures for manual verification; production-like mode requires real embedding and Qdrant endpoints.

## Verification strategy

- Unit tests cover canonicalization, chunk boundaries, stable IDs, deduplication, embedding batching, dimension checks, Qdrant request mapping, score fusion, deterministic ties, and safe error mapping.
- Repository tests assert ACL filtering before and after vector hydration, bounded limits, stale filtering, fallback behavior, and unchanged public schemas.
- Ingestion tests run twice to prove idempotence and then with a changed revision to prove stale-vector replacement.
- Integration tests are skipped unless `KCP_I3_INTEGRATION=true` and use disposable MySQL/Qdrant services.
- HTTP/STDIO contract tests discover the same seven tools and three resource templates before and after I3 is enabled.
- Operational tests verify readiness transitions for unavailable Qdrant, dimension mismatch, embedding timeout, and graceful shutdown.
- Manual tests document local ingestion, vector search, ACL isolation, failure recovery, and evidence handling.

## Acceptance criteria

I3 is complete when a clean environment can run the offline suite unchanged, an opt-in local stack can ingest the same fixture twice without duplicate vectors, a changed revision replaces only its prior vectors, hybrid search returns stable cited results, unauthorized principals cannot retrieve restricted chunks, dependency incompatibility keeps readiness false, and all sensitive-output tests pass.
