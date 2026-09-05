# I5-B — Indexación controlada de corpus GitLab remoto

**Estado:** Aprobado para planificación  
**Fecha:** 2026-09-05  
**Precede:** I5-A — ingesta OKF read-only desde GitLab

## 1. Objetivo

Completar el flujo de I5-A conectando la lectura remota de un repositorio GitLab con el compilador OKF y el indexador I3 existente. I5-B permitirá validar un corpus controlado de GitLab en el índice de conocimiento sin duplicar la lógica de compilación, ACL, hash, chunking ni persistencia.

La primera versión indexará únicamente documentos `stable`. Los documentos `draft`, `stale`, `deprecated`, `superseded` y `archived` permanecerán en el reporte de compilación, pero no modificarán el índice estable.

## 2. Alcance

### Incluido

- Resolver una revisión GitLab inmutable y conservar su SHA.
- Leer el árbol y los archivos Markdown mediante el puerto read-only de I5-A.
- Compilar el corpus remoto con las validaciones OKF y de gobernanza existentes.
- Generar la proyección compatible con el `FilesystemDocumentSource` y el indexador I3.
- Indexar solo documentos `stable` válidos.
- Mantener idempotencia cuando se repite el mismo proyecto, revisión y contenido.
- Reemplazar de forma segura una revisión anterior cuando cambia el corpus.
- Devolver conteos, `corpusHash`, proyecto, revisión y resultado de indexación sin incluir tokens ni cuerpos documentales.
- Ejecutar el flujo offline con adaptadores fake y documentarlo como prueba manual.

### Fuera de alcance

- Aprobar Merge Requests o publicar propuestas; eso permanece en I4-B.
- Cambiar archivos, ramas o estados en GitLab.
- Indexar automáticamente documentos no `stable`.
- Google Drive, PDF, Docling/Tika, Kafka, DLQ, portal web, Vault, OKE y dashboard.
- Crear un segundo modelo de documento o un segundo indexador.
- Reemplazar la política de precedencia GitLab/OKF/Drive; se conserva la definida por los PRD.

## 3. Diseño

El orquestador recibirá una fuente GitLab configurada y reutilizará `compileOkfCorpus` con el `GitLabSourcePort` de I5-A. Una vez compilado el corpus, pasará la proyección resultante al flujo I3 existente.

```text
GitLab ref
   │ resolve SHA + read tree/files (GET only)
   ▼
GitLabSourcePort
   │
   ▼
OKF compiler ── validation/governance ── corpusHash
   │
   ├─ errors > 0 or no stable documents → no index mutation
   │
   ▼
Projection writer
   │ manifest + documents stable-only
   ▼
I3 indexer ── MySQL catalog + Qdrant vectors
   │
   ▼
safe result: counts, revision, hash, indexed/skipped status
```

El orquestador será una capa de aplicación pequeña. No conocerá detalles de HTTP GitLab ni duplicará el algoritmo de chunking/vectorización; recibirá una dependencia I3/fake inyectable para pruebas.

## 4. Identidad e idempotencia

La identidad lógica de una ejecución será:

```text
sourceSystem=gitlab
projectId
resolvedRevision
corpusHash
```

El `corpusHash` debe ser determinista para una misma revisión y contenido. Repetir una ejecución con esa identidad no debe crear duplicados en MySQL ni vectores duplicados en Qdrant. Una revisión o hash diferente debe permitir que I3 reemplace la revisión anterior según sus reglas actuales de idempotencia.

La indexación se considerará exitosa únicamente cuando la escritura de catálogo y vectores cumpla el contrato existente. Si la compilación contiene errores, la proyección indexable será vacía y no se invocará el indexador.

## 5. Contrato de resultado y errores

El resultado seguro deberá incluir como mínimo:

- `projectId`;
- `ref` y `resolvedRevision`;
- `corpusHash`;
- conteos `discovered`, `valid`, `indexable`, `errors`;
- estado `indexed`, `skipped` o `failed`;
- cantidad de documentos indexados y omitidos.

Los errores se normalizarán a categorías existentes o nuevas de dominio sin incluir token, headers, cuerpo completo de GitLab ni contenido documental. Casos mínimos:

- fuente GitLab no configurada o no disponible;
- respuesta de árbol/archivo inválida;
- corpus OKF inválido;
- ausencia de documentos `stable`;
- fallo de proyección;
- fallo de MySQL/Qdrant.

En todos los casos de validación, configuración o lectura remota, el índice debe permanecer sin cambios.

## 6. Configuración y seguridad

I5-B reutilizará `KCP_GITLAB_SOURCE_*` de I5-A y la configuración I3 existente. La ejecución remota estará deshabilitada por defecto. El token solo se enviará en el header del adaptador HTTP y nunca se incluirá en resultados o logs.

La operación seguirá siendo explícita, por ejemplo mediante un comando dedicado de indexación GitLab. El comando local existente no cambiará de semántica y no seleccionará GitLab por accidente.

## 7. Pruebas y aceptación

Se agregarán pruebas unitarias y de aceptación con fakes para demostrar:

1. corpus remoto estable válido: compila e indexa;
2. repetición de la misma revisión: no duplica catálogo ni vectores;
3. nueva revisión: reemplaza la revisión previa según I3;
4. corpus con error: no invoca el indexador;
5. corpus sin documentos `stable`: no modifica el índice;
6. fallo de Qdrant/MySQL: devuelve fallo seguro y conserva la política de cleanup existente;
7. token y contenido documental no aparecen en errores ni resultados;
8. el flujo local I3 existente conserva sus pruebas y comportamiento.

La prueba manual cubrirá configuración, ejecución fake, ejecución autorizada contra el proyecto GitLab demo, repetición idempotente, cambio de revisión y verificación de ausencia de mutaciones en el repositorio GitLab.

## 8. Criterios de aceptación

- Un corpus GitLab válido con al menos un documento `stable` produce una proyección e indexación I3 exitosa.
- Un corpus inválido no modifica MySQL ni Qdrant.
- Una segunda ejecución idéntica es idempotente.
- Una revisión nueva reemplaza la anterior sin duplicar resultados activos.
- Los documentos no `stable` no aparecen en el índice estable.
- Se conservan `sourceUri`, `sourceRevision`, ACL, estado y citas.
- `npm run build`, `npm run typecheck`, pruebas enfocadas y smoke MCP pasan.
- La documentación manual permite repetir la prueba sin exponer credenciales.

## 9. Incrementos posteriores

I5-B no implementará todavía Drive, preguntas de oro, observabilidad distribuida ni hardening de producción. Esos temas quedarán para I5-C/I5-D después de validar el flujo GitLab → OKF → I3.
