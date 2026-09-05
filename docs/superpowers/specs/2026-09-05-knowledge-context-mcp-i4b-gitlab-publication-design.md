# I4-B — Diseño de publicación OKF mediante GitLab MR/CI

**Fecha:** 2026-09-05  
**Estado:** Propuesta aprobada para planificación  
**Alcance:** Publicación gobernada de propuestas OKF mediante puerto/adaptador GitLab

## 1. Objetivo

Añadir una capacidad de publicación gobernada que convierta una proyección OKF válida en una propuesta versionada en GitLab, mediante una rama y un Merge Request reproducibles. La aprobación humana seguirá siendo obligatoria; ningún documento se promocionará a `stable` por la sola creación del MR.

El incremento debe permitir probar todo el flujo localmente con un fake de GitLab y habilitar la API real únicamente mediante configuración explícita de CI o de un operador autorizado.

## 2. Contexto y restricciones

- I4-A ya valida corpus OKF y genera proyecciones deterministas para I3.
- GitLab conserva la evidencia oficial y el repositorio OKF conserva el conocimiento curado.
- El MCP continúa siendo de lectura; no se agregan herramientas MCP de mutación.
- El servicio no aprobará MRs, no cambiará estados por sí mismo y no indexará `stable` desde ramas no aprobadas.
- El token GitLab solo se obtiene desde el entorno seguro de ejecución; nunca desde archivos OKF, argumentos, UI o logs.
- No forman parte de I4-B el portal React, conectores GitLab/Drive, Kafka, Docling/Tika, Vault, OKE ni el dashboard operacional.
- Se preservan los cambios no relacionados que existan en el workspace.

## 3. Arquitectura por puerto/adaptador

El caso de uso de publicación depende de un puerto abstracto y no de `fetch` ni de una librería GitLab concreta.

```text
OKF corpus -> Compiler I4-A -> PublicationService -> GitLabPort
                                      |              |
                                      |              +-- FakeGitLabAdapter (tests/offline)
                                      +---------------- GitLabHttpAdapter (CI/operación)
```

El puerto modela únicamente las operaciones necesarias: inspeccionar el estado de una rama base, crear o reutilizar una rama de propuesta, crear un commit con un conjunto de archivos, crear o consultar un MR y obtener el estado de aprobación/CI. El adaptador HTTP traduce estas operaciones a la API GitLab y normaliza errores a códigos seguros del dominio.

## 4. Contrato de publicación

`PublicationRequest` contiene:

- identificador del proyecto GitLab;
- rama base permitida;
- nombre o prefijo de la rama de propuesta;
- corpus OKF compilado sin errores;
- título y descripción de la propuesta;
- etiquetas y revisores configurados;
- modo `proposal` o `approved-publish`;
- identidad de correlación no sensible.

`PublicationResult` contiene únicamente:

- branch creado o reutilizado;
- commit SHA;
- MR IID y URL canónica;
- estado del MR y de CI;
- cantidad y rutas de archivos publicados;
- resultado `proposal-created` o `stable-publish-authorized`.

No se devolverán tokens, headers, payloads completos de GitLab ni cuerpos documentales completos.

## 5. Reglas de gobierno

La publicación se bloquea si:

1. el compilador devuelve errores;
2. el proyecto o la rama base no están permitidos por configuración;
3. falta el token o el token no tiene el alcance mínimo requerido;
4. la rama base cambió y el plan no fue calculado contra su SHA esperado;
5. existe un MR abierto equivalente con el mismo hash de corpus;
6. el resultado intenta publicar documentos que no son `stable` en modo `approved-publish`;
7. el MR no está aprobado o CI no está verde cuando se solicita promoción estable.

En modo `proposal`:

- se publica el artefacto generado como propuesta;
- se crea o reutiliza un MR idempotente;
- los documentos permanecen `draft` o en su estado de propuesta;
- no se inicia la indexación estable.

En modo `approved-publish`:

- se exige una rama/commit aprobados y CI verde;
- se vuelve a validar y compilar el contenido de esa revisión;
- solo entonces se entrega la proyección al indexador I3;
- el resultado debe conservar commit, MR, aprobación, procedencia y hash del corpus.

## 6. Idempotencia y concurrencia

La identidad idempotente de una propuesta será:

```text
projectId + baseBranch + corpusHash + publicationMode
```

El adaptador debe buscar un MR abierto con esa identidad antes de crear otro. Si la rama ya existe y apunta al mismo contenido, se reutiliza. Si apunta a contenido diferente, el servicio devuelve `PUBLICATION_CONFLICT` y no sobrescribe la rama sin una nueva solicitud explícita.

El SHA de la rama base se captura antes del plan y se verifica antes de crear el commit. Un cambio concurrente devuelve `BASE_BRANCH_CHANGED` para que el operador regenere la propuesta.

## 7. CLI y CI

Se añadirán comandos equivalentes a:

- `okf:publish --mode proposal`: valida, compila y abre/reutiliza un MR.
- `okf:publish --mode approved-publish`: valida la revisión aprobada y entrega la proyección al indexador I3.
- `okf:publication-plan`: muestra el plan seguro sin modificar GitLab.

El pipeline deberá ejecutar validación antes de publicación y hacer fallar el job ante errores de esquema/gobierno. El job de promoción estable requerirá variables protegidas para proyecto, rama, token y modo. Las pruebas normales no dependerán de GitLab real.

## 8. Errores y seguridad

Los errores de dominio serán acotados y accionables:

- `PUBLICATION_INVALID_CORPUS`;
- `GITLAB_AUTH_REQUIRED`;
- `GITLAB_FORBIDDEN`;
- `GITLAB_PROJECT_NOT_ALLOWED`;
- `BASE_BRANCH_CHANGED`;
- `PUBLICATION_CONFLICT`;
- `MR_ALREADY_OPEN`;
- `APPROVAL_REQUIRED`;
- `CI_NOT_GREEN`;
- `GITLAB_UNAVAILABLE`.

Los logs podrán incluir código, proyecto anonimizado, rama, SHA, MR IID, conteos y latencia. No podrán incluir token, cabeceras de autorización, contenido completo, payload de GitLab ni mensajes de excepción sin sanitizar.

## 9. Pruebas y criterios de aceptación

Se implementarán pruebas TDD para:

- plan determinista de una propuesta;
- corpus inválido bloqueado antes de invocar GitLab;
- fake GitLab que crea rama, commit y MR;
- reutilización idempotente del MR por hash;
- conflicto cuando la rama apunta a otro contenido;
- base branch modificada;
- token ausente, permisos insuficientes y proyecto no permitido;
- aprobación/CI requeridos para `approved-publish`;
- paridad de errores entre fake y adaptador HTTP;
- ausencia de secretos y contenido completo en logs/resultados;
- regresión del CLI I4-A y del indexador I3.

La aceptación de I4-B requiere demostrar que:

1. una propuesta válida crea un MR reproducible sin publicar `stable`;
2. repetir la propuesta no crea duplicados;
3. un corpus inválido no invoca GitLab;
4. un conflicto de rama detiene la publicación sin sobrescritura;
5. la promoción exige aprobación y CI verde;
6. la proyección promovida conserva hash, commit, MR, procedencia y ACL;
7. GitLab real solo se activa mediante configuración explícita y sus credenciales no aparecen en salida;
8. las pruebas offline pasan sin red ni servicios externos.

## 10. Fuera de alcance

- UI de portal y administración de conectores.
- Descubrimiento/ingesta de GitLab o Google Drive.
- Creación automática de candidatos OKF desde PDFs o documentos externos.
- Kafka, DLQ, OCR, almacenamiento de originales y dashboard.
- Aprobación automática o modificación de reglas de protección de ramas.
- Despliegue OKE, Vault y observabilidad distribuida completa.

## 11. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| API GitLab cambia o responde con formatos distintos | Adaptador aislado, schemas de respuesta y pruebas contractuales |
| Se crean MRs duplicados | Identidad por proyecto, rama, hash y modo; búsqueda previa idempotente |
| Se publica desde una base obsoleta | Verificación del SHA de la rama base antes del commit |
| Un token aparece en logs | Sanitización centralizada y pruebas de salida sensible |
| Un MR de propuesta llega al índice estable | Separar modos y exigir aprobación/CI en `approved-publish` |

## 12. Decisión

I4-B se implementará mediante `PublicationService` y `GitLabPort`, con un adaptador HTTP real detrás de configuración explícita y un fake determinista para pruebas offline. La publicación será propuesta por defecto; la promoción estable será una operación separada y verificable.
