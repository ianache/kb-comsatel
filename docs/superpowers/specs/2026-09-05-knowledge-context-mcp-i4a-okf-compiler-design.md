# I4-A — Diseño del Knowledge Compiler OKF

**Fecha:** 2026-09-05  
**Estado:** Propuesta aprobada para planificación  
**Alcance:** Knowledge Compiler OKF integrado con la indexación local I3

## 1. Objetivo

Construir un compilador determinista que valide un corpus de conocimiento en OKF v0.2, aplique las reglas de gobierno de estados y produzca una proyección lista para el indexador actual de MySQL/Qdrant. El compilador debe impedir que un corpus inválido o un documento no publicable llegue al índice estable.

El incremento completa la primera vertical de I4: fuente OKF → validación → proyección indexable → indexación controlada. La publicación mediante Merge Request, CI remoto y aprobación humana queda separada para I4-B.

## 2. Contexto y restricciones

- El MCP sigue siendo de lectura; I4-A no agrega herramientas de mutación.
- GitLab, Drive, Kafka, Vault, portal React, Docling/Tika y despliegue OKE no forman parte de este incremento.
- La ACL y la procedencia existentes en I3 deben conservarse en la proyección.
- No se deben registrar secretos, documentos completos ni contenido sensible en errores o logs.
- Se mantienen los cambios no relacionados que ya existan en el workspace.

## 3. Entrada OKF

El compilador recibe un directorio de archivos Markdown. Cada archivo contiene frontmatter YAML y cuerpo Markdown. El contrato mínimo del documento incluye:

- identificador único y estable;
- tipo/concepto OKF;
- título y contenido;
- estado de gobierno;
- propietario o responsable;
- fuentes y referencias de procedencia;
- clasificación/ACL;
- fechas de revisión y, cuando aplique, `stale_after`;
- relaciones a otros conceptos, incluyendo `superseded_by`.

Los detalles exactos del esquema se encapsularán en un módulo versionado para permitir evolución de OKF sin acoplar el CLI al parser.

## 4. Reglas de validación y gobierno

La compilación falla de forma explícita si ocurre cualquiera de estas condiciones:

1. YAML inválido, campos obligatorios ausentes o tipos incorrectos.
2. IDs duplicados, relaciones a IDs inexistentes o ciclos no permitidos.
3. Fuente ausente, incompleta o incompatible con la procedencia requerida.
4. Fecha inválida, `stale_after` incoherente o documento vencido sin marcar.
5. Documento `stable` sin propietario, evidencia, ACL o metadatos de revisión.
6. Documento `superseded` sin sucesor válido.
7. Estado o transición no soportados.

La política de publicación será:

- `draft`: puede compilarse para revisión, pero no se proyecta como estable.
- `stable`: puede proyectarse al índice estable si pasa todas las validaciones.
- `stale`: conserva trazabilidad, pero no se presenta como conocimiento vigente.
- `deprecated`: no se ofrece como resultado vigente.
- `superseded`: conserva la referencia al sucesor y no sustituye al sucesor en búsquedas estables.

La compilación no aprobará documentos ni cambiará estados; solo verificará y clasificará el resultado.

## 5. Salida del compilador

Para una entrada válida se generan artefactos reproducibles:

1. `manifest.json`: versión del contrato, hash del corpus, conteos, errores/advertencias y fecha de compilación controlada.
2. Proyección de documentos con identidad, estado, ACL, fuentes, relaciones y contenido normalizado.
3. Proyección de chunks compatible con el indexador I3, preservando documento, sección, posición y procedencia.
4. Resumen de qué elementos son indexables como estables y cuáles quedan fuera o requieren revisión.

El orden de archivos, documentos y chunks será determinista. El hash del corpus no dependerá de la hora de ejecución ni del orden del sistema de archivos.

Para una entrada inválida no se deben emitir artefactos publicables ni iniciar la indexación. El reporte debe incluir archivo, campo, código de error y mensaje accionable, sin incluir el contenido completo del documento.

## 6. Integración con I3

- El CLI ejecutará primero validación y compilación; solo si no existen errores bloqueantes invocará el flujo de indexación.
- La proyección debe alimentar el repositorio/indexador existente sin duplicar la lógica de ACL, hash, deduplicación o estados de indexación.
- Una compilación repetida con la misma entrada debe producir el mismo resultado y una segunda indexación debe ser idempotente.
- Los filtros de estado, revisión, procedencia y ACL del MCP deben seguir funcionando sobre documentos compilados.
- Los documentos `draft`, vencidos, deprecated o superseded no deben filtrarse accidentalmente como conocimiento estable.

## 7. Interfaz operativa

Se añadirá un CLI local/CI con operaciones equivalentes a:

- `validate`: valida el corpus y devuelve código de salida no cero ante errores.
- `compile`: valida y genera artefactos deterministas.
- `index`: compila y, solo si es válido, ejecuta la indexación configurada.

La interfaz debe aceptar directorio de entrada y directorio de salida, configuración de modo (`draft` o `stable`) y parámetros de dependencias existentes. Los mensajes serán aptos para CI y no expondrán secretos.

## 8. Pruebas y criterios de aceptación

Se implementarán pruebas antes del código para:

- frontmatter válido e inválido;
- IDs duplicados y relaciones rotas;
- reglas de cada estado y transiciones no válidas;
- fechas y `stale_after`;
- ACL, fuentes y procedencia obligatorias;
- corpus determinista;
- ausencia de artefactos ante fallo;
- compatibilidad de la proyección con el indexador I3;
- idempotencia de una segunda indexación;
- aislamiento de `draft` y documentos no vigentes en recuperación estable;
- CLI y códigos de salida;
- regresión del flujo I3 existente.

La aceptación de I4-A requiere demostrar que:

1. un corpus válido genera una proyección indexable y reproducible;
2. un corpus inválido no altera MySQL ni Qdrant;
3. `stable` exige evidencia, propietario, ACL y revisión;
4. `draft` nunca aparece como estable;
5. `superseded` conserva su sucesor y no reemplaza al sucesor;
6. una ejecución repetida no duplica documentos ni vectores;
7. las citas del MCP mantienen fuente, revisión y localización;
8. la ejecución de I3 existente continúa operativa.

## 9. Fuera de alcance para I4-A

- Creación de ramas, commits o Merge Requests en GitLab.
- Pipeline GitLab CI remoto y reglas de aprobación.
- Conectores GitLab/Drive y cargas del portal.
- Kafka, DLQ y dashboard operacional.
- UI web y administración de conectores.
- OCR, Docling, Tika y almacenamiento de binarios originales.
- Vault, OKE, observabilidad distribuida y hardening de producción.

## 10. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| El esquema real de OKF evoluciona | Encapsular el esquema y versionar el contrato |
| La proyección duplica reglas de I3 | Reutilizar interfaces y repositorios existentes |
| Estados inconsistentes contaminan el índice | Validación bloqueante antes de indexar |
| Resultados no reproducibles | Ordenamiento explícito y hash sin timestamps |
| Errores filtran contenido sensible | Errores estructurados por ubicación, nunca por documento completo |

## 11. Decisión

I4-A se implementará como una vertical local y verificable sobre el indexador I3. La publicación gobernada en GitLab se planificará como I4-B después de que esta especificación y su plan sean revisados.
