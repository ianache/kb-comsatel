# Knowledge Context MCP I3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add opt-in document ingestion, deterministic chunking, configurable embeddings, Qdrant vector search, and hybrid lexical/vector retrieval while preserving the I1/I2 MCP contract.

**Architecture:** Keep `ContextEngine`, the seven MCP tools, and the three resource templates unchanged. Add focused retrieval boundaries for normalized source documents, embeddings, vectors, catalog writes, and chunk hydration; compose them only when I3 is explicitly enabled. Store metadata and searchable chunk text in MySQL, vectors and filter-only payloads in Qdrant, and hydrate all public results from authorized MySQL rows.

**Tech Stack:** Node.js 22, TypeScript, MySQL 8.4, Qdrant REST API through `fetch`, Fastify 5, Zod 4, Vitest, Docker Compose, and the existing MCP SDK/jose/mysql2 stack.

**Spec:** `docs/superpowers/specs/2026-09-05-knowledge-context-mcp-i3-design.md`

## Global Constraints

- Preserve the seven tool names and three resource URI templates exactly.
- Keep I1 STDIO offline by default; I3 is enabled only through explicit configuration.
- Keep `ContextEngine` responsible for evidence, citations, warnings, budgets, and audit policy.
- Apply ACL-compatible filters before vector candidate retrieval and recheck authorization during MySQL hydration.
- Store no JWT, prompt, full document text, credential, or vector in logs or public Qdrant payloads.
- Bound every retrieval path to at most `limit * 3` candidates and at most 20 public results.
- Use deterministic canonicalization, chunk IDs, score fusion, tie-breaking, and test fixtures.
- Ingestion is not exposed as a public MCP mutation tool.
- Qdrant and embedding failures keep readiness false during startup; runtime lexical fallback is allowed only when a usable lexical result exists.
- Integration tests require `KCP_I3_INTEGRATION=true`; unit and offline contract tests must not require MySQL, Qdrant, or an embedding service.
- Every task ends with focused tests, typecheck/format checks where relevant, and a commit.

---

### Task 1: Add I3 contracts and configuration boundaries

**Files:**

- Create: `src/retrieval/source-document.ts`
- Create: `src/retrieval/document-source.ts`
- Create: `src/retrieval/embedding-provider.ts`
- Create: `src/retrieval/vector-store.ts`
- Create: `src/retrieval/catalog-writer.ts`
- Modify: `src/config.ts`
- Modify: `src/ops/runtime-dependencies.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `tests/retrieval/i3-interfaces.test.ts`
- Create: `tests/config-i3.test.ts`

**Interfaces:**

- `SourceDocument` contains `knowledgeId`, `title`, `sourceSystem`, `sourceUri`, `sourceRevision`, `product`, `domain`, `classification`, `status`, `content`, `locator`, `verifiedAt`, `staleAfter`, and ACL metadata.
- `DocumentSource.list(): AsyncIterable<SourceDocument>`.
- `EmbeddingProvider.embed(texts: readonly string[]): Promise<EmbeddingBatch>` where `EmbeddingBatch` contains `model`, `dimension`, and vectors in input order.
- `VectorStore.ensureCollection(spec)`, `upsert(points)`, `deleteByRevision(knowledgeId, sourceRevision)`, `search(query, filter, limit)`, `health()`, and `close()`.
- `CatalogWriter.beginIndexRun`, `upsertDocument`, `replaceChunks`, `completeIndexRun`, and `failIndexRun`.

- [ ] **Step 1: Write failing interface tests**

```ts
it("accepts independent fakes for source, embeddings, vectors, and catalog", async () => {
  const source: DocumentSource = { list: async function* () {} };
  const embeddings: EmbeddingProvider = {
    embed: async (texts) => ({
      model: "test",
      dimension: 3,
      vectors: texts.map(() => [0, 0, 0]),
    }),
  };
  expect(source.list).toBeTypeOf("function");
  expect(embeddings.embed).toBeTypeOf("function");
});
```

- [ ] **Step 2: Run focused tests and verify the expected failure**

Run: `npm test -- tests/retrieval/i3-interfaces.test.ts tests/config-i3.test.ts`

Expected: FAIL because I3 contracts and configuration fields do not exist.

- [ ] **Step 3: Add the contract types and schemas**

Define the exact types above. Use Zod schemas for source manifests, collection specifications, vector points, search filters, and index-run statuses. Keep source content in the source boundary only; vector payload types may contain identifiers and filter dimensions but no text.

- [ ] **Step 4: Add explicit configuration**

Add these fields and defaults:

```text
KCP_I3_ENABLED=false
KCP_I3_SOURCE_DIR=./fixtures/i3
KCP_I3_QDRANT_ENABLED=false
KCP_I3_QDRANT_URL=http://127.0.0.1:6333
KCP_I3_QDRANT_COLLECTION=knowledge_chunks
KCP_I3_VECTOR_DIMENSION=3
KCP_I3_VECTOR_DISTANCE=Cosine
KCP_I3_EMBEDDING_URL=
KCP_I3_EMBEDDING_MODEL=local-test
KCP_I3_EMBEDDING_API_KEY=
KCP_I3_EMBEDDING_TIMEOUT_MS=10000
KCP_I3_CHUNK_TARGET_CHARS=1200
KCP_I3_CHUNK_OVERLAP_CHARS=160
KCP_I3_CHUNK_MAX_CHARS=1800
KCP_I3_VECTOR_WEIGHT=0.65
KCP_I3_LEXICAL_WEIGHT=0.35
KCP_I3_CANDIDATE_MULTIPLIER=3
```

Reject I3 startup when enabled without Qdrant URL/collection, a positive dimension, valid chunk bounds, or an embedding URL unless the deterministic local provider is explicitly selected. Reject weights whose sum is not positive.

- [ ] **Step 5: Run checks and commit**

Run: `npm test -- tests/retrieval/i3-interfaces.test.ts tests/config-i3.test.ts && npm run typecheck && npm run format:check`

Commit:

```bash
git add src/retrieval src/config.ts src/ops/runtime-dependencies.ts package.json package-lock.json tests/retrieval/i3-interfaces.test.ts tests/config-i3.test.ts
git commit -m "feat: add I3 retrieval contracts and configuration"
```

### Task 2: Add MySQL chunk and index-state schema

**Files:**

- Create: `db/migrations/003_i3_chunks.sql`
- Create: `db/migrations/004_i3_indexes.sql`
- Modify: `src/catalog/migrations.ts`
- Create: `src/catalog/mysql-catalog-writer.ts`
- Modify: `src/catalog/mysql-row-mappers.ts`
- Create: `tests/catalog/i3-migrations.test.ts`
- Create: `tests/catalog/mysql-catalog-writer.test.ts`

**Interfaces:**

- `MySqlCatalogWriter implements CatalogWriter` using the existing `SqlExecutor`.
- `knowledge_chunks` stores `chunk_id`, `knowledge_id`, `source_revision`, ordinal, bounded chunk text, content hash, token/character estimate, locator fields, and timestamps.
- `knowledge_index_runs` stores run ID, source revision, status (`running|completed|failed`), model, dimension, counts, bounded failure code, and timestamps.

- [ ] **Step 1: Write failing migration assertions**

Assert that migration SQL contains the two tables, foreign keys to artifact/revision identity, uniqueness on `(knowledge_id, source_revision, ordinal)`, and indexes for revision lookup, content hash, status, and lexical search.

- [ ] **Step 2: Run the migration tests to verify failure**

Run: `npm test -- tests/catalog/i3-migrations.test.ts tests/catalog/mysql-catalog-writer.test.ts`

Expected: FAIL because the new migrations and writer do not exist.

- [ ] **Step 3: Add the migrations**

Use InnoDB, utf8mb4, `DATETIME(3)` UTC timestamps, bounded `TEXT`/`VARCHAR` fields, foreign keys, and a full-text index over chunk text/title if supported by the existing MySQL version. Do not add columns for prompts, JWTs, credentials, or raw vectors.

- [ ] **Step 4: Implement parameterized writer operations**

Use only `SqlExecutor.execute/query`. `replaceChunks` must delete only the target artifact revision, insert the new chunks with parameters, and never concatenate source content into SQL. `failIndexRun` stores a safe failure code, not the original exception text.

- [ ] **Step 5: Add writer tests**

Use a recording fake executor to assert parameter binding, revision scoping, idempotent replacement, and absence of sensitive field names/content in SQL strings.

- [ ] **Step 6: Run checks and commit**

Run: `npm test -- tests/catalog/i3-migrations.test.ts tests/catalog/mysql-catalog-writer.test.ts tests/catalog/migrations.test.ts && npm run typecheck && npm run format:check`

Commit:

```bash
git add db/migrations/003_i3_chunks.sql db/migrations/004_i3_indexes.sql src/catalog/migrations.ts src/catalog/mysql-catalog-writer.ts src/catalog/mysql-row-mappers.ts tests/catalog/i3-migrations.test.ts tests/catalog/mysql-catalog-writer.test.ts
git commit -m "feat: add I3 chunk and index-state catalog schema"
```

### Task 3: Implement deterministic canonicalization, chunking, and filesystem source

**Files:**

- Create: `src/retrieval/canonicalizer.ts`
- Create: `src/retrieval/chunker.ts`
- Create: `src/retrieval/filesystem-document-source.ts`
- Create: `tests/retrieval/canonicalizer.test.ts`
- Create: `tests/retrieval/chunker.test.ts`
- Create: `tests/retrieval/filesystem-document-source.test.ts`
- Create: `fixtures/i3/manifest.json`
- Create: `fixtures/i3/public-unit-rule.md`
- Create: `fixtures/i3/restricted-adr.md`

**Interfaces:**

- `canonicalizeDocument(document): CanonicalDocument`.
- `chunkDocument(document, options): readonly DocumentChunk[]`.
- `FilesystemDocumentSource({ directory, manifestFile }): DocumentSource`.

- [ ] **Step 1: Write failing canonicalization tests**

Cover CRLF/LF normalization, Unicode normalization, trimmed whitespace, repeated blank-line collapse, stable content hash, and preservation of source locator metadata.

- [ ] **Step 2: Write failing chunking tests**

Cover heading-aware boundaries, configured overlap, hard maximum, stable ordinal/chunk ID, no empty chunks, and deterministic output on repeated runs.

- [ ] **Step 3: Write failing filesystem-source tests**

Use a fixture manifest with two documents. Assert required metadata, relative content loading, rejection of path traversal, and safe errors for malformed manifests.

- [ ] **Step 4: Implement canonicalizer and chunker**

Canonicalize before hashing. Split first at headings/paragraphs, then hard-wrap oversized sections. Derive IDs from `knowledgeId|sourceRevision|ordinal` using a stable hash. Preserve section/page/line locators on each chunk.

- [ ] **Step 5: Implement the filesystem source**

Validate the manifest with Zod, resolve content paths beneath the configured root, reject absolute paths and `..` escapes, and emit only normalized `SourceDocument` records.

- [ ] **Step 6: Run checks and commit**

Run: `npm test -- tests/retrieval/canonicalizer.test.ts tests/retrieval/chunker.test.ts tests/retrieval/filesystem-document-source.test.ts && npm run typecheck && npm run format:check`

Commit:

```bash
git add src/retrieval/canonicalizer.ts src/retrieval/chunker.ts src/retrieval/filesystem-document-source.ts tests/retrieval fixtures/i3
git commit -m "feat: add deterministic I3 document preparation"
```

### Task 4: Implement embeddings and Qdrant vector store

**Files:**

- Create: `src/retrieval/http-embedding-provider.ts`
- Create: `src/retrieval/deterministic-embedding-provider.ts`
- Create: `src/retrieval/qdrant-vector-store.ts`
- Create: `src/retrieval/vector-filters.ts`
- Create: `tests/retrieval/http-embedding-provider.test.ts`
- Create: `tests/retrieval/qdrant-vector-store.test.ts`
- Create: `tests/retrieval/vector-filters.test.ts`
- Modify: `docker-compose.i2.yml`
- Create: `docker-compose.i3.yml`

**Interfaces:**

- `HttpEmbeddingProvider` calls a configured HTTP-compatible endpoint and validates model, vector count, finite values, and configured dimension.
- `DeterministicEmbeddingProvider` returns stable vectors for offline tests only.
- `QdrantVectorStore` maps `VectorStore` operations to Qdrant REST endpoints using injected `fetch` for tests.

- [ ] **Step 1: Write failing embedding tests**

Assert batching preserves order, sends model/texts in the request body, includes authorization only when configured, rejects malformed responses/dimension mismatch, times out, and never includes the API key in thrown messages.

- [ ] **Step 2: Write failing Qdrant mapping tests**

Assert collection creation/validation, point upsert, revision deletion, bounded query limit, payload mapping, cosine distance configuration, and safe mapping of non-2xx responses.

- [ ] **Step 3: Write failing ACL filter tests**

Build Qdrant filters from principal products/domains/classifications and active status. Assert that no raw SQL or complete principal claims are sent to Qdrant and empty dimensions do not create invalid filters.

- [ ] **Step 4: Implement providers and vector store**

Use `AbortController` for embedding timeout. Use Qdrant REST paths under the configured base URL, `wait=true` for writes, and payloads containing only IDs and filter dimensions. `health()` must validate collection dimension, distance, and model metadata.

- [ ] **Step 5: Add opt-in Qdrant Compose service**

Create `docker-compose.i3.yml` with Qdrant only, loopback binding, healthcheck, named volume, and no production credentials. Keep I2 Compose unchanged.

- [ ] **Step 6: Run checks and commit**

Run: `npm test -- tests/retrieval/http-embedding-provider.test.ts tests/retrieval/qdrant-vector-store.test.ts tests/retrieval/vector-filters.test.ts && npm run typecheck && npm run format:check`

Commit:

```bash
git add src/retrieval/http-embedding-provider.ts src/retrieval/deterministic-embedding-provider.ts src/retrieval/qdrant-vector-store.ts src/retrieval/vector-filters.ts tests/retrieval docker-compose.i3.yml
git commit -m "feat: add configurable embeddings and Qdrant vector store"
```

### Task 5: Implement the idempotent ingestion indexer

**Files:**

- Create: `src/retrieval/ingestion-indexer.ts`
- Modify: `src/catalog/mysql-catalog-writer.ts`
- Create: `tests/retrieval/ingestion-indexer.test.ts`

**Interfaces:**

- `IngestionIndexer.ingest(source: DocumentSource): Promise<IngestionSummary>`.
- The indexer consumes `DocumentSource`, canonicalizer/chunker, `EmbeddingProvider`, `VectorStore`, and `CatalogWriter`.

- [ ] **Step 1: Write failing idempotence tests**

Ingest the same two-document fixture twice. Assert the second run has zero new embeddings/upserts, one completed state per revision, and no duplicate chunks/vectors.

- [ ] **Step 2: Write failing revision-replacement tests**

Change one source revision and content. Assert the old revision is deleted from the active vector set, the new chunks are written, and unchanged documents are not re-embedded.

- [ ] **Step 3: Write failing failure-transition tests**

Make embedding or Qdrant fail. Assert `failIndexRun` receives a bounded code, the new revision is not marked searchable, and the error contains no source text or credentials.

- [ ] **Step 4: Implement the indexer state machine**

For each source document: canonicalize, hash, compare revision/hash state, begin run, chunk, embed in bounded batches, upsert vectors, replace catalog chunks, then complete the run. On failure, delete any newly written revision vectors when possible and mark the run failed.

- [ ] **Step 5: Run checks and commit**

Run: `npm test -- tests/retrieval/ingestion-indexer.test.ts tests/retrieval/canonicalizer.test.ts tests/retrieval/chunker.test.ts && npm run typecheck && npm run format:check`

Commit:

```bash
git add src/retrieval/ingestion-indexer.ts src/catalog/mysql-catalog-writer.ts tests/retrieval/ingestion-indexer.test.ts
git commit -m "feat: add idempotent I3 ingestion indexer"
```

### Task 6: Add chunk hydration and hybrid retrieval

**Files:**

- Create: `src/retrieval/chunk-reader.ts`
- Create: `src/retrieval/score-fusion.ts`
- Create: `src/catalog/hybrid-repository.ts`
- Modify: `src/catalog/mysql-repository.ts`
- Modify: `src/catalog/mysql-row-mappers.ts`
- Create: `tests/retrieval/score-fusion.test.ts`
- Create: `tests/catalog/hybrid-repository.test.ts`

**Interfaces:**

- `ChunkReader.readSearchItems(chunkIds, principal): Promise<SearchKnowledgeResult["results"]>`.
- `HybridKnowledgeRepository implements KnowledgeRepository` and delegates direct reads/listing to the existing repository.

- [ ] **Step 1: Write failing score-fusion tests**

Cover weighted reciprocal rank, duplicate knowledge IDs, missing lexical/vector candidates, stable tie-breaking, and output cap at the requested limit.

- [ ] **Step 2: Write failing hydration/ACL tests**

Use fake lexical results and vector candidates. Assert vector IDs are hydrated through MySQL, unauthorized chunks are discarded, stale filters are respected, and Qdrant payload text is never returned directly.

- [ ] **Step 3: Implement chunk reader**

Add a parameterized `readSearchItems` query to `MySqlKnowledgeRepository` that joins chunk, revision, artifact, and ACL predicates, maps citations/locators, and returns only authorized rows.

- [ ] **Step 4: Implement score fusion**

Use the configured lexical/vector weights and reciprocal-rank constant. Deduplicate by `knowledgeId`, retain the highest-scoring authorized chunk, and sort by score then `knowledgeId` then `chunkId`.

- [ ] **Step 5: Implement hybrid repository search**

Embed the query once, run lexical and vector retrieval with candidate limit `min(60, input.limit * multiplier)`, tolerate vector failure when lexical results exist, hydrate vector IDs through MySQL, fuse, and return the existing `SearchKnowledgeResult` schema. Delegate all non-search methods unchanged.

- [ ] **Step 6: Run checks and commit**

Run: `npm test -- tests/retrieval/score-fusion.test.ts tests/catalog/hybrid-repository.test.ts tests/catalog/mysql-repository.test.ts tests/engine/context-engine.test.ts && npm run typecheck && npm run format:check`

Commit:

```bash
git add src/retrieval/chunk-reader.ts src/retrieval/score-fusion.ts src/catalog/hybrid-repository.ts src/catalog/mysql-repository.ts src/catalog/mysql-row-mappers.ts tests/retrieval/score-fusion.test.ts tests/catalog/hybrid-repository.test.ts
git commit -m "feat: add ACL-aware hybrid knowledge retrieval"
```

### Task 7: Compose I3 runtime and ingestion command

**Files:**

- Modify: `src/config.ts`
- Modify: `src/ops/runtime-dependencies.ts`
- Modify: `src/server.ts`
- Create: `src/retrieval/i3-runtime.ts`
- Create: `src/ingestion/i3-cli.ts`
- Modify: `package.json`
- Create: `tests/server/i3-composition.test.ts`
- Create: `tests/ingestion/i3-cli.test.ts`
- Modify: `.env.i2.example`
- Create: `.env.i3.example`

**Interfaces:**

- `createI3Runtime(config): { repository, indexer, health, close }`.
- `npm run i3:index -- --source-dir <path>` runs the controlled ingestion path and prints only counts/status.

- [ ] **Step 1: Write failing composition tests**

Assert I3-disabled configuration creates the existing in-memory runtime, I3-enabled local-test configuration creates filesystem source/deterministic embeddings/Qdrant client, and missing Qdrant or embedding settings fail before readiness.

- [ ] **Step 2: Write failing CLI tests**

Assert source directory and dry-run validation, successful count summary, nonzero exit on failed index run, and absence of document text/API keys in output.

- [ ] **Step 3: Implement runtime composition**

Create the writer, source, embedding provider, vector store, indexer, and hybrid repository only when `KCP_I3_ENABLED=true`. Preserve I2 composition when false. Make startup call vector `health()` and keep readiness false until it succeeds.

- [ ] **Step 4: Implement the ingestion command**

Use `tsx` through a package script. Accept only source directory and optional `--dry-run`; use environment configuration for all service endpoints and secrets. Do not expose ingestion through the MCP server.

- [ ] **Step 5: Add configuration examples**

Document local deterministic mode and production-like mode separately. Keep all secrets blank or clearly local-only.

- [ ] **Step 6: Run checks and commit**

Run: `npm test -- tests/server/i3-composition.test.ts tests/ingestion/i3-cli.test.ts && npm run typecheck && npm run format:check`

Commit:

```bash
git add src/config.ts src/ops/runtime-dependencies.ts src/server.ts src/retrieval/i3-runtime.ts src/ingestion/i3-cli.ts package.json tests/server/i3-composition.test.ts tests/ingestion/i3-cli.test.ts .env.i2.example .env.i3.example
git commit -m "feat: compose I3 runtime and ingestion command"
```

### Task 8: Add opt-in integration tests and operational/manual documentation

**Files:**

- Create: `tests/integration/i3-qdrant-mysql.test.ts`
- Create: `scripts/i3-integration-smoke.mjs`
- Modify: `.gitlab-ci.yml`
- Create: `docs/operations/i3-indexing.md`
- Create: `docs/manual-tests/i3-hybrid-retrieval.md`
- Modify: `README.md`

- [ ] **Step 1: Write the gated integration test**

Skip unless `KCP_I3_INTEGRATION=true`. When enabled, connect to disposable MySQL/Qdrant, apply migrations, ingest fixtures twice, query hybrid results, verify ACL isolation, change one revision, and verify replacement without duplicates.

- [ ] **Step 2: Add the integration smoke script**

Make the script exit zero with a clear skip message when the flag is absent and otherwise report only counts, statuses, latency, and collection health.

- [ ] **Step 3: Add CI jobs**

Keep the default CI suite offline. Add an opt-in integration job keyed by `KCP_I3_INTEGRATION`, with MySQL/Qdrant services only when the variable is explicitly supplied. Add the offline I3 unit/contract tests to the standard test job.

- [ ] **Step 4: Document operations and manual tests**

Document collection compatibility, reindex procedure, failed-run recovery, readiness behavior, source fixture format, ACL checks, secret handling, and cleanup commands.

- [ ] **Step 5: Run the complete verification**

Run:

```bash
npm test
npm run typecheck
npm run build
npm run format:check
npm run smoke
node scripts/i3-integration-smoke.mjs
```

Expected: all offline checks pass; the integration script prints an explicit skip unless `KCP_I3_INTEGRATION=true`; STDIO smoke still discovers seven tools and three resource templates.

- [ ] **Step 6: Commit**

```bash
git add tests/integration scripts/i3-integration-smoke.mjs .gitlab-ci.yml docs/operations/i3-indexing.md docs/manual-tests/i3-hybrid-retrieval.md README.md
git commit -m "test: add I3 integration smoke and operational guidance"
```

### Task 9: Final review, security audit, and acceptance evidence

**Files:**

- Modify: `docs/superpowers/plans/2026-09-05-knowledge-context-mcp-i3.md`
- Create: `tests/security/i3-sensitive-output.test.ts`
- Create: `tests/retrieval/i3-acceptance.test.ts`

- [ ] **Step 1: Add sensitive-output tests**

Assert logs/errors/HTTP responses do not contain API keys, JWTs, prompts, full document text, SQL, vectors, or complete claims.

- [ ] **Step 2: Add acceptance tests**

Assert I3 disabled preserves I2 behavior, I3 fixture ingestion is idempotent, changed revisions replace vectors, hybrid ordering is deterministic, ACL isolation holds, vector failure falls back only with lexical evidence, and readiness fails on dimension mismatch.

- [ ] **Step 3: Run the final gate**

Run the complete commands from Task 8 plus `git diff --check`. Confirm Graphify is updated after all code/docs changes and record the final node/edge summary in the handoff.

- [ ] **Step 4: Mark the plan complete and commit**

Mark every completed checkbox in this plan, then:

```bash
git add docs/superpowers/plans/2026-09-05-knowledge-context-mcp-i3.md tests/security/i3-sensitive-output.test.ts tests/retrieval/i3-acceptance.test.ts
git commit -m "test: finalize I3 acceptance and security coverage"
```
