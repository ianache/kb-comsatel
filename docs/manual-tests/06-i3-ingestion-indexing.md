# 06 - I3 ingesta e indexacion

## Objetivo

Validar manualmente el flujo completo de ingesta: manifiesto, canonicalizacion, chunking, embeddings, persistencia MySQL, indexacion Qdrant, idempotencia, reemplazo de revisiones y recuperacion ante fallos.

## Precondiciones

1. Node.js 22 y Docker disponibles.
2. MySQL levantado con `docker-compose.i2.yml`.
3. Qdrant levantado con `docker-compose.i3.yml`.
4. Variables configuradas desde `.env.i3.example` y un `KCP_MYSQL_URL` local valido.
5. No guardar contrasenas, API keys, JWT completos ni texto documental completo en la evidencia.

```powershell
docker compose --env-file .env.i3.example -f docker-compose.i2.yml up -d
docker compose --env-file .env.i3.example -f docker-compose.i3.yml up -d
docker compose -f docker-compose.i2.yml ps
docker compose -f docker-compose.i3.yml ps
```

## Casos

### I3-ING-01 - configuracion y readiness

`npm run dev` no carga `.env.i3.example` automaticamente. En PowerShell, configurar las variables antes de arrancar:

```powershell
$env:KCP_MYSQL_ENABLED = "true"
$env:KCP_MYSQL_URL = "mysql://kcp:change-me-locally@127.0.0.1:3307/knowledge_context"
$env:KCP_I3_ENABLED = "true"
$env:KCP_I3_QDRANT_ENABLED = "true"
$env:KCP_I3_QDRANT_URL = "http://127.0.0.1:6333"
$env:KCP_I3_QDRANT_COLLECTION = "knowledge_chunks"
$env:KCP_I3_VECTOR_DIMENSION = "3"
$env:KCP_I3_VECTOR_DISTANCE = "Cosine"
$env:KCP_I3_EMBEDDING_MODEL = "local-test"
$env:KCP_I3_SOURCE_DIR = "./fixtures/i3"
npm run dev
```

Arrancar MySQL y Qdrant antes de este paso. Si aparece solo `Startup failed`, revisar las lineas inmediatamente anteriores en la terminal; no compartir passwords, API keys ni JWTs.

Si MySQL ya tenia un volumen inicializado con otra contrasena, el valor de `KCP_MYSQL_URL` debe coincidir con esa contrasena. No usar `down -v` para corregirlo sin confirmar que se pueden eliminar los datos de prueba.

Esperado: readiness solo se anuncia despues de validar MySQL, Qdrant y dimension/distancia. Con I3 deshabilitado, se conserva el comportamiento I1/I2.

### I3-ING-02 - coleccion Qdrant

Qdrant no crea `knowledge_chunks` al levantar el contenedor. Primero iniciar el runtime I3 con la configuracion del caso I3-ING-01. El arranque de la aplicacion valida la configuracion y crea la coleccion.

```powershell
npm run dev
```

En otra terminal, consultar:

```powershell
curl.exe http://127.0.0.1:6333/collections/knowledge_chunks
```

Ingresar a http://127.0.0.1:6333/dashboard#/welcome

Esperado despues de arrancar I3: `200`, la coleccion existe, usa dimension `3` y distancia `Cosine`. El `404 Not found` antes de arrancar I3 es normal y significa que Qdrant esta disponible pero aun no ha recibido la inicializacion de la coleccion. Si se usa `npm run i3:index` en vez de `npm run dev`, la CLI tambien crea la coleccion antes de ingerir. Un cambio intencional de `KCP_I3_VECTOR_DIMENSION` impide readiness con un error seguro.

### I3-ING-03 - primera ingesta

```powershell
npm run i3:index -- --source-dir ./fixtures/i3
```

Esperado: resumen JSON con documentos procesados, chunks, vectores y `failed: 0`. Consultar:

```sql
SELECT knowledge_id, source_revision, status, chunk_count, vector_count
FROM knowledge_index_runs
ORDER BY started_at DESC;
```

Las dos revisiones de los fixtures deben terminar en `completed` y los conteos deben coincidir con MySQL/Qdrant.

### I3-ING-04 - repeticion idempotente

Ejecutar nuevamente el mismo comando sin modificar fixtures.

Esperado: `processed: 0`, `skipped: 2`, sin nuevos chunks ni nuevos puntos Qdrant.

### I3-ING-05 - reemplazo de revision

Modificar el contenido de `public-unit-rule.md` y actualizar su `sourceRevision` en el manifiesto. Ejecutar la ingesta.

Esperado: se crea una nueva revision, se reemplazan sus chunks y vectores, y el documento no modificado no se re-embebe. Restaurar fixture y manifiesto al terminar.

### I3-ING-06 - ACL de documento restringido

Usar `restricted-adr.md` y dos principales: uno perteneciente a `architecture-reviewers` y otro sin ese grupo.

Esperado: el principal autorizado recibe el resultado con cita; el no autorizado recibe vacio/not-found. El texto restringido nunca aparece en respuesta, logs ni payload publico de Qdrant.

### I3-ING-07 - filtros y evidencia

Buscar con filtros de producto, dominio, estado y `verifiedOnly`. Repetir con un filtro que no coincide.

Esperado: los filtros se respetan en Qdrant y en la rehidratacion MySQL; el resultado conserva cita, estado de evidencia y limite solicitado.

### I3-ING-08 - fallo de embedding o Qdrant

Detener Qdrant durante la ingesta o configurar temporalmente un endpoint de embedding inaccesible.

Esperado: `knowledge_index_runs.status` queda en `failed` con `failure_code` acotado, no quedan vectores parciales y no se imprimen contenido fuente ni credenciales.

### I3-ING-09 - recuperacion

Restaurar Qdrant/configuracion y repetir la ingesta.

Esperado: la revision fallida termina en `completed` y queda una sola copia searchable de sus chunks/vectores.

## Evidencia requerida

- commit probado, fecha/hora y version de Node/npm;
- salida sanitizada del comando de ingesta;
- estado de servicios y `/ready`;
- conteos de `knowledge_index_runs`, `knowledge_chunks` y Qdrant;
- resultado autorizado y denegado del caso ACL;
- evidencia de idempotencia, reemplazo y recuperacion;
- ausencia de secretos y contenido completo.

## Limpieza

```powershell
docker compose -f docker-compose.i3.yml down
docker compose -f docker-compose.i2.yml down
```

Usar `down -v` solo si los datos locales de prueba pueden eliminarse.
