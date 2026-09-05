# I5-A — Diseño de ingesta read-only desde GitLab

**Fecha:** 2026-09-05  
**Estado:** Aprobado para planificación  
**Alcance:** Leer un repositorio GitLab controlado como fuente OKF, sin mutaciones

## 1. Objetivo

Permitir que el compilador OKF existente lea documentos Markdown desde un proyecto GitLab y una revisión fija, manteniendo la validación, procedencia y reglas de gobierno de I4-A. El repositorio GitLab será una fuente de conocimiento; la aplicación seguirá ejecutándose desde el checkout de GitHub.

## 2. Alcance y exclusiones

Incluye:

- listar archivos de un proyecto GitLab en una rama, tag o commit;
- restringir la lectura a una ruta raíz configurada;
- seleccionar archivos Markdown de forma recursiva;
- leer contenido y metadatos mínimos de cada archivo;
- compilar el resultado con las reglas OKF existentes;
- conservar proyecto, ruta y revisión en la procedencia;
- fake offline y adaptador HTTP con errores seguros.

No incluye:

- creación de ramas, commits o Merge Requests;
- aprobación o publicación estable;
- conectores Google Drive, portal React, Kafka, Vault u OKE;
- indexación I3 automática en este incremento;
- almacenamiento de credenciales en archivos, argumentos o documentos.

## 3. Arquitectura

```text
GitLab REST -> GitLabSourcePort -> OkfSourceReader -> OKF compiler -> I4-A projection
                    |                    |
                    +-- Fake adapter    +-- local filesystem adapter
```

`GitLabSourcePort` abstrae la lectura remota. El adaptador HTTP usará únicamente endpoints GET de GitLab v4:

- `GET /projects/:id/repository/tree?recursive=true&ref=:ref&path=:root`;
- `GET /projects/:id/repository/files/:file_path/raw?ref=:ref`;
- `GET /projects/:id/repository/commits/:ref` para resolver el SHA cuando sea necesario.

El identificador del proyecto acepta ID numérico o path completo. El token se obtiene solo del entorno y se envía como `PRIVATE-TOKEN`; nunca aparece en resultados, logs o errores.

## 4. Contrato de fuente

La fuente debe poder devolver:

- `relativePath` estable dentro de la ruta raíz;
- contenido UTF-8;
- `sourceUri` canónica del proyecto, revisión y ruta;
- `sourceRevision` como SHA de commit cuando GitLab lo entrega;
- `sourceSystem: "gitlab"`.

Los archivos se ordenan por ruta antes de compilar. Solo se leen extensiones `.md` y se rechazan rutas fuera de la raíz solicitada. La compilación falla de forma segura si el proyecto, revisión o ruta no son accesibles.

## 5. CLI y configuración

Se agregará una forma explícita de seleccionar fuente GitLab para validación/compilación, manteniendo el flujo local compatible. Variables previstas:

```text
KCP_GITLAB_SOURCE_ENABLED=false
KCP_GITLAB_SOURCE_PROJECT_ID=
KCP_GITLAB_SOURCE_REF=main
KCP_GITLAB_SOURCE_ROOT=
KCP_GITLAB_SOURCE_TOKEN=
KCP_GITLAB_SOURCE_TIMEOUT_MS=10000
```

La fuente GitLab no se activa por defecto. El comando debe producir conteos, hash, revisión y rutas, sin imprimir contenido completo ni credenciales.

## 6. Errores y seguridad

Se normalizan al dominio existente o a códigos específicos de fuente:

- configuración incompleta;
- autenticación inválida;
- acceso prohibido;
- proyecto/revisión/ruta inexistente;
- respuesta REST inválida;
- timeout o indisponibilidad.

El cuerpo remoto no se copia a mensajes de error. Los archivos Markdown se tratan como contenido no confiable y no ejecutable.

## 7. Pruebas y aceptación

Se implementarán pruebas TDD para:

- listado recursivo y filtro `.md`;
- lectura ordenada y determinista;
- path de proyecto URL-encoded;
- revisión fija y procedencia GitLab;
- 401, 403, 404, timeout y schema inválido;
- token ausente y ausencia de secretos en salida;
- equivalencia entre compilación local y remota para el mismo corpus;
- regresión de I4-A e I3 offline.

La aceptación requiere demostrar que `kb-demo` puede leerse desde una revisión explícita, que el corpus produce el mismo hash/proyección esperados y que ninguna operación muta GitLab.

## 8. Decisión

I5-A se implementará como un puerto/adaptador read-only que reutiliza el compilador OKF. La indexación I3 y la evaluación piloto se planificarán como incrementos posteriores, después de validar la lectura remota y la procedencia.
