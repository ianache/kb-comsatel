# Manual I3 — hybrid retrieval and indexing

## Preconditions

1. Start MySQL using `docker-compose.i2.yml` and Qdrant using `docker-compose.i3.yml`.
2. Configure `.env.i3.example`, a local `KCP_MYSQL_URL`, and `KCP_I3_SOURCE_DIR=./fixtures/i3`.
3. Never put passwords, API keys, or complete JWTs in the evidence.

## Cases

### I3-MAN-01 — first ingestion

Run `npm run i3:index -- --source-dir ./fixtures/i3`.

Expected: JSON summary with processed documents, chunks, vectors, and zero failures. Query `knowledge_index_runs` and confirm completed rows.

### I3-MAN-02 — idempotent repeat

Run the same command again.

Expected: `processed: 0`, `skipped` equal to the fixture document count, and no increase in chunk/vector counts.

### I3-MAN-03 — hybrid search

Start HTTP local mode with I3 enabled and invoke `search_knowledge` for a phrase present in a fixture. Confirm the result has a citation, stable ordering, and a bounded result count.

### I3-MAN-04 — ACL isolation

Index one fixture restricted to `architecture-reviewers`. Search with a principal in that group and another without it.

Expected: only the authorized principal receives the restricted evidence; the unauthorized response is empty/not-found and contains no chunk text.

### I3-MAN-05 — collection mismatch

Change `KCP_I3_VECTOR_DIMENSION` to a value different from the existing collection and restart.

Expected: startup fails or readiness remains false with a safe compatibility error. Restore the original value before continuing.

### I3-MAN-06 — vector outage fallback

Stop Qdrant while MySQL lexical data remains available and run a search.

Expected: lexical evidence may be returned with a degraded internal condition; if lexical retrieval is empty, the operation returns a safe internal error and no uncited content.
