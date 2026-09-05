# 04 — MySQL, migraciones y ACL

## Objetivo

Validar pool, migraciones, repositorio parametrizado, ACL y auditoría con MySQL local.

## Preparación

1. Copiar `.env.i2.example` a un archivo local fuera de Git o exportar sus variables.
2. Iniciar MySQL:

```powershell
docker compose --env-file .env.i2.example -f docker-compose.i2.yml up -d
docker compose -f docker-compose.i2.yml ps
```

3. Configurar la aplicación:

```powershell
$env:KCP_MYSQL_ENABLED = "true"
$env:KCP_MYSQL_URL = "mysql://kcp:change-me-locally@127.0.0.1:3307/knowledge_context"
$env:KCP_HTTP_ENABLED = "true"
$env:KCP_HTTP_LOCAL_MODE = "true"
npm run dev
```

## Casos

### DB-01 — arranque y migraciones

Verificar `/ready` y consultar:

```sql
SHOW TABLES;
SELECT filename FROM schema_migrations ORDER BY filename;
```

Esperado: existen `knowledge_artifacts`, `knowledge_revisions`, `knowledge_excerpts`, `knowledge_acl`, `knowledge_taxonomies`, `knowledge_audit_events` y las dos migraciones aparecen una sola vez.

### DB-02 — parámetros y ausencia de SQL inyectado

Ejecutar búsquedas con comillas, `%`, `_` y `x' OR '1'='1`. Confirmar que la respuesta no falla con SQL, no amplía resultados y que el valor no aparece incrustado en logs.

### DB-03 — ACL positivo/negativo

Insertar un artifact de prueba con una fila ACL para un grupo de prueba y otro artifact con una ACL que el principal no posee. Consultar con principales con y sin el grupo.

Esperado: solo el principal autorizado puede ver el artifact; el no autorizado obtiene vacío/not-found indistinguible de inexistencia.

### DB-04 — auditoría agregada

Tras una búsqueda autorizada y una denegada:

```sql
SELECT principal_id, operation, filter_keys, result_count,
       authorization, evidence_status, latency_ms, created_at
FROM knowledge_audit_events
ORDER BY audit_id DESC
LIMIT 2;
```

Esperado: aparecen únicamente campos agregados, timestamp UTC y ningún prompt, token, JWT, extracto o contenido documental.

## Limpieza

```powershell
docker compose -f docker-compose.i2.yml down
```

No usar `down -v` salvo que se haya confirmado que los datos de prueba pueden eliminarse.
