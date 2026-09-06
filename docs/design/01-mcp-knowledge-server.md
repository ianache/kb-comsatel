# Knowledge Context MCP — Arquitectura

**Ubicación:** `src/` · **Runtime:** Node.js/TypeScript · **Protocolo:** Model Context Protocol (MCP)

## Qué es

Un servidor MCP que expone un **catálogo de conocimiento de solo lectura** a clientes MCP
(agentes de IA, IDEs). Se construye en **capas de capacidad opcionales** (I1 → I5b), activables por
variables de entorno — la configuración por defecto es offline, en memoria y sin autenticación,
pensada para desarrollo local sin dependencias externas.

## Punto de entrada y configuración

- `src/server.ts` — arranca el proceso.
- `src/config.ts` (`loadConfig()`) — única fuente de configuración de runtime; decide qué
  subsistemas opcionales (MySQL, Keycloak/JWKS, OpenTelemetry, retrieval I3) están activos.
- `src/ops/runtime-dependencies.ts` — composition root: ensambla qué implementación concreta de
  repositorio/auth/observabilidad usar según `loadConfig()`.

## Capas (por directorio bajo `src/`)

```
mcp/          Superficie del protocolo: contratos de tools/resources, transporte HTTP/stdio
  │
engine/       ContextEngine — orquestador central que llaman los handlers de tools MCP
  │
catalog/      Abstracción del repositorio de conocimiento (3 implementaciones intercambiables)
  │
retrieval/    Pipeline de retrieval híbrido I3 (chunking, embeddings, vectores)
  │
ingestion/    Adaptadores de fuente (GitLab, Google Drive) que alimentan el pipeline OKF
  │
okf/          Compilador del "Open Knowledge Format" — valida y compila el corpus
  │
publication/  Publica el OKF compilado de vuelta a GitLab (Merge Requests)
  │
security/     Resolución de identidad para el modo HTTP autenticado (JWKS/OIDC)
  │
ops/          Salud, logging estructurado, OpenTelemetry, composition root
  │
domain/       Tipos y jerarquía de errores compartidos
  │
evaluation/   Harness de regresión sobre un dataset "golden" de retrieval
```

### `mcp/` — superficie del protocolo

- `tools.ts` / `resources.ts` — definen el contrato MCP (qué tools y resource templates existen).
- `adapter.ts` — conecta esos contratos al `ContextEngine`.
- `http-server.ts` / `http-auth.ts` / `http-errors.ts` — transporte HTTP Streamable opcional
  (autenticado); **stdio es el transporte por defecto y siempre disponible**, sin autenticación
  (asume que el proceso que lo invoca ya es de confianza — el caso típico de un cliente MCP local).

El servidor stdio (I1) expone exactamente **siete tools de solo lectura**:
`search_knowledge`, `get_knowledge_excerpt`, `get_artifact_lineage`, `build_context_pack`,
`get_task_context`, `get_provenance`, `list_stale_concepts` — más resource templates para
artefactos, revisiones de artefactos y dominios de taxonomía. `npm run smoke` valida que esta
superficie exacta no cambie por accidente.

**Regla de transporte crítica:** en modo stdio, el protocolo MCP usa `stdout` exclusivamente para
mensajes de protocolo. Cualquier diagnóstico operativo va a `stderr` — nunca se debe escribir algo
que no sea protocolo a `stdout`, o se corrompe la conversación con el cliente MCP.

### `engine/` — orquestación

- `context-engine.ts` (`ContextEngine`) — el objeto que llaman todos los handlers de tools MCP;
  es el punto central que coordina catálogo + retrieval + auditoría para responder cada tool.
- `audit.ts` / `mysql-audit-sink.ts` — persistencia agregada de auditoría (quién pidió qué, cuándo).

### `catalog/` — el repositorio de conocimiento

Interfaz única (`repository.ts`) con **tres implementaciones intercambiables**, elegidas por
`runtime-dependencies.ts` según config:

| Implementación | Cuándo se usa | Backing store |
|---|---|---|
| `memory-repository.ts` | Por defecto (I1) | En memoria, sembrado desde `seed.ts` |
| `mysql-repository.ts` | I2 (`KCP_MYSQL_ENABLED=true`) | MySQL persistente |
| `hybrid-repository.ts` | I3 (`KCP_I3_ENABLED=true`) | Metadata del catálogo + retrieval vectorial fusionados |

### `retrieval/` — pipeline híbrido (I3)

```
filesystem-document-source.ts
  → canonicalizer.ts        (normaliza el documento)
  → chunker.ts               (lo parte en fragmentos indexables)
  → embedding-provider.ts    (genera vectores — determinístico en test, HTTP real en prod)
  → qdrant-vector-store.ts   (persiste los vectores en Qdrant)
```

Los resultados vectoriales se combinan con los resultados del catálogo relacional vía
`score-fusion.ts`. `ingestion-indexer.ts` e `i3-runtime.ts` orquestan el CLI `i3:index` que dispara
todo este pipeline sobre un directorio de documentos.

### `ingestion/` — adaptadores de fuente

Interfaz `source-port.ts`, con un par real/fake por fuente:
`gitlab-http-source-adapter.ts` / `fake-gitlab-source-adapter.ts` y
`google-drive-http-adapter.ts` / `fake-google-drive-source.ts`. Los "fakes" no son solo para tests
unitarios aislados — también se usan en desarrollo offline; conviene revisar los call sites antes
de asumir que un fake es exclusivo de test.

**Nota:** este `ingestion/` (adaptadores de fuente para el pipeline OKF, en Node/TypeScript) es un
concepto **distinto** del microservicio `ingestion-api` del Portal (FastAPI/Python, ver
[`02-portal-km-comsatel.md`](./02-portal-km-comsatel.md)) — no comparten proceso ni código, aunque
ambos hablan de "ingesta" y ambos hablan con GitLab/Drive.

### `okf/` — el pipeline "Open Knowledge Format"

- `corpus-reader.ts` + `frontmatter-parser.ts` — leen documentos fuente Markdown con frontmatter YAML.
- `okf-schema.ts` / `okf-types.ts` — validan ese frontmatter contra el esquema OKF v0.2.
- `compiler.ts` (`compileOkfCorpus()`) — compila un corpus válido en artefactos listos para catálogo.
- `projection-writer.ts` — escribe las proyecciones compiladas.
- `governance.ts` — reglas de publicación (qué puede publicarse y cómo).

Ver la sección "Contenido del catálogo (OKF v0.2)" de `CLAUDE.md` para el esquema completo de
frontmatter (`knowledgeId`, `artifactType`, `classification`, `status`, `acl`, `relations`, etc.).

### `publication/` — de vuelta a GitLab

`gitlab-port.ts` (interfaz) + `gitlab-http-adapter.ts`/`fake-gitlab-adapter.ts` (real/fake),
`publication-plan.ts` + `publication-service.ts` — toman el OKF compilado y lo publican como Merge
Requests en GitLab.

### `security/` — identidad para el modo HTTP autenticado

`principal-resolver.ts` (interfaz) + `keycloak-principal-resolver.ts` + `oidc-discovery.ts` —
valida JWTs contra el JWKS de Keycloak cuando el servidor corre en modo HTTP autenticado. El modo
stdio no pasa por aquí (no tiene autenticación — ver nota de transporte arriba).

### `ops/` — operación transversal

`health-server.ts` (`/health`, `/ready`), `structured-logger.ts` (pino, solo `stderr`),
`otel.ts`/`observability-context.ts`/`observability-types.ts` (export OpenTelemetry opcional),
`metrics-registry.ts`, y `runtime-dependencies.ts` como composition root.

## Niveles de capacidad (tiers)

| Tier | Qué añade | Cómo se activa | Requiere |
|---|---|---|---|
| **I1** (default) | Catálogo en memoria, sin auth, stdio | — | Nada externo |
| **I2** | Persistencia MySQL, auth Keycloak/JWKS, auditoría agregada, HTTP Streamable autenticado | `KCP_MYSQL_ENABLED=true` + `KCP_MYSQL_URL` | MySQL (`docker-compose.i2.yml` para local) |
| **I3** | Ingesta de filesystem, chunking/embeddings determinísticos, vectores Qdrant, estado de índice en MySQL, retrieval híbrido | `KCP_I3_ENABLED=true` | MySQL + Qdrant (`docker-compose.i3.yml`), o modo `local-test` para checks determinísticos sin infraestructura |

I2 por sí solo **no** implementa Qdrant, embeddings, retrieval semántico híbrido, llamadas
runtime a Vault, despliegue Kubernetes, ingesta del portal, conectores de fuente, tools de
mutación, ni una UI web — todo eso vive en I3 o más allá.

## Contrato de transporte y superficie (resumen operativo)

- HTTP (`KCP_HTTP_ENABLED=true`) exige `Authorization: Bearer <token>` salvo que
  `KCP_HTTP_LOCAL_MODE=true` esté explícitamente activado para pruebas de contrato locales — este
  modo **nunca** debe habilitarse en producción. HTTP en producción requiere
  `KCP_KEYCLOAK_ISSUER` y `KCP_KEYCLOAK_AUDIENCE`.
- Las respuestas de error nunca deben incluir tokens, SQL, prompts, ni contenido de documentos.

## Tests y evaluación

`tests/` espeja la estructura de `src/` por directorio, más `tests/integration/` para flujos
end-to-end stdio/HTTP y `tests/fixtures/` para datos golden y de ejemplo OKF. `evaluation/`
(`golden-cli.ts`, `golden-runner.ts`, `golden-dataset.ts`, `golden-report.ts`) corre regresiones
de calidad de retrieval/contexto contra un dataset de referencia (`npm run eval:golden`).

## Comandos clave

```bash
npm ci && npm run build && npm test && npm run typecheck && npm run format:check   # gate de calidad completo
npm run smoke                                                                        # arranca stdio, valida superficie MCP
npm run dev -- --stdio                                                               # servidor stdio local
npm run i3:index -- --source-dir <dir>                                               # ingesta filesystem I3
npm run okf:validate / okf:compile / okf:index                                       # pipeline OKF (variantes okf:source-*/okf:drive-*)
npm run eval:golden                                                                  # regresión de calidad golden
```

Ver `docs/operations/i1-local-development.md` y `docs/operations/i3-indexing.md` para el detalle
operativo completo de cada tier.
