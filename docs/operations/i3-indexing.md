# I3 indexing operations

I3 is opt-in. The default I1/I2 runtime remains offline or MySQL-only according to its existing configuration. I3 requires MySQL metadata storage, Qdrant, and either the deterministic `local-test` embedding provider for local checks or a configured HTTP-compatible embedding endpoint.

## Start local Qdrant

```powershell
docker compose --env-file .env.i3.example -f docker-compose.i3.yml up -d
docker compose -f docker-compose.i3.yml ps
```

Configure `KCP_MYSQL_ENABLED=true`, `KCP_MYSQL_URL`, `KCP_I3_ENABLED=true`, `KCP_I3_QDRANT_ENABLED=true`, and the values from `.env.i3.example`. Startup keeps `/ready` unavailable until migrations and Qdrant collection compatibility pass.

## Index fixtures

```powershell
npm run i3:index -- --source-dir ./fixtures/i3
```

The command prints counts/status only. Repeating it with the same source revision is a no-op. A changed revision creates new chunks and vectors; failed runs are recorded in `knowledge_index_runs`.

## Collection compatibility

The configured collection must use the configured vector dimension and distance. A mismatch is a startup failure; do not change dimension or model in place. Create a new collection name and reindex when changing embedding dimensions/models.

## Recovery and cleanup

Inspect `knowledge_index_runs` for `failed` runs and their bounded `failure_code`. Fix the dependency or source, then rerun the indexing command. Do not delete MySQL data or the Qdrant volume during routine recovery.

```powershell
docker compose -f docker-compose.i3.yml down
```

Use `down -v` only after confirming that local vector data is disposable.
