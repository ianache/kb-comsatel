# I5-C — Ingesta read-only desde Google Drive

**Estado:** Aprobado para planificación  
**Fecha:** 2026-09-05  
**Precede:** I5-B — indexación controlada de corpus GitLab remoto

## 1. Objetivo

Agregar una fuente Google Drive de solo lectura para completar el corpus controlado del piloto I5. El conector descubrirá archivos dentro de carpetas explícitamente configuradas, conservará metadatos/procedencia y entregará Markdown o PDF al flujo de compilación e indexación ya validado en I5-B.

La primera versión utilizará un token OAuth de lectura inyectado por configuración y una lista explícita de `folderId`. No incluirá login interactivo, portal web ni escritura en Drive.

## 2. Alcance

### Incluido

- Configurar una o más carpetas Drive mediante `folderId`.
- Listar archivos no eliminados con paginación determinista.
- Leer metadatos: `fileId`, nombre, MIME, tamaño, versión, fecha de modificación, URL y permisos disponibles.
- Descargar Markdown y PDF con operaciones GET.
- Calcular SHA-256 del contenido descargado.
- Emitir `sourceUri`, `sourceRevision` y metadatos suficientes para trazabilidad e idempotencia.
- Reutilizar el compilador OKF y el orquestador/indexador I5-B.
- Indexar únicamente documentos `stable` cuando el contenido corresponda a OKF válido.
- Mantener idempotencia por `fileId + revision/version + SHA-256`.
- Probar el flujo offline mediante fake y fetcher controlado.

### Fuera de alcance

- Flujo interactivo OAuth, refresh-token UI o administración de usuarios.
- Crear, editar, mover, compartir o eliminar archivos Drive.
- Google Docs/Sheets/Slides nativos y exportaciones complejas.
- OCR, Docling, Tika, extracción avanzada de PDF o clasificación automática.
- Kafka, DLQ, portal React, Vault, OKE, dashboard y observabilidad distribuida.
- Resolver contradicciones GitLab/Drive automáticamente; se conservará la precedencia definida por los PRD.

## 3. Diseño

Se añadirá un puerto Drive independiente del puerto GitLab. El adaptador HTTP traducirá la API Drive v3 a operaciones de dominio; el compilador/indexador no conocerá URLs, headers ni formatos de paginación de Google.

```text
folderIds + OAuth read token
          │ GET files.list (paginado)
          ▼
GoogleDriveSourcePort
          │ metadata + GET media
          ▼
Drive source files
          │ fileId/version/SHA-256/sourceUri
          ▼
OKF compiler + I5-B index orchestrator
          │ stable-only projection
          ▼
MySQL catalog + Qdrant vectors
```

El puerto tendrá operaciones equivalentes a:

```ts
interface GoogleDriveSourcePort {
  listFiles(input: {
    folderIds: readonly string[];
  }): Promise<readonly DriveFileMetadata[]>;
  readFile(input: {
    fileId: string;
    metadata: DriveFileMetadata;
  }): Promise<DriveSourceFile>;
}
```

`DriveFileMetadata` incluirá `fileId`, `name`, `mimeType`, `sizeBytes`, `version`, `modifiedTime`, `webUrl`, `folderId` y permisos reducidos a los campos necesarios para ACL/procedencia. El contenido completo no viajará en listados ni errores.

## 4. Descubrimiento y contenido

La consulta de listado debe restringirse a archivos no eliminados dentro de las carpetas configuradas. Se solicitarán campos explícitos y se seguirá `nextPageToken` hasta terminar. El resultado se ordenará por `folderId`, ruta/nombre y `fileId` para que el hash y las pruebas sean deterministas.

La primera versión aceptará:

- `text/markdown` y extensiones `.md`: lectura directa mediante `alt=media`;
- `application/pdf` y extensiones `.pdf`: descarga binaria, con representación textual limitada solo si el adaptador de extracción configurado puede producirla.

Un tipo no soportado se marcará como `skipped` con una razón segura y no bloqueará otros archivos del lote. Si un PDF no puede extraerse, se registrará `failed` sin indexar contenido incompleto.

## 5. Revisión, hash y procedencia

La revisión preferida será `version` de Drive. Si la API no la entrega para un archivo, se utilizará una combinación estable de `modifiedTime` y `md5Checksum` cuando esté disponible; el SHA-256 calculado localmente siempre será obligatorio para idempotencia.

La identidad de contenido será:

```text
sourceSystem=google-drive
fileId
revision
sha256
```

El `sourceUri` será el enlace web del archivo cuando esté disponible. `sourceRevision` conservará la versión Drive y el `locator` conservará al menos la ruta/nombre; página o sección solo se añadirá cuando la extracción lo produzca sin inventar coordenadas.

## 6. Seguridad y errores

- El token OAuth solo se enviará como `Authorization: Bearer` en el adaptador HTTP.
- Todas las operaciones Drive de I5-C serán GET.
- El token, Authorization header, cuerpo de error y contenido completo no aparecerán en logs, excepciones ni resultados.
- La fuente estará deshabilitada por defecto.
- Proyectos/folders vacíos, permisos insuficientes, HTTP 401/403/404/429/5xx, JSON inválido, descarga truncada y MIME no soportado tendrán códigos seguros.
- Un error de un archivo no debe mezclar contenido de otro archivo ni provocar indexación parcial de ese archivo.
- La lista de carpetas será explícita; no se permitirá explorar todo el Drive por defecto.

## 7. Integración con I5-B

El adaptador Drive producirá archivos de fuente que el compilador pueda consumir mediante una capa de normalización compartida. El orquestador I5-B recibirá el corpus normalizado con `sourceSystem: "google-drive"`, conservará `sourceUri/sourceRevision`, filtrará estados no `stable` y delegará la persistencia al mismo indexador I3.

No se copiará la lógica de chunking, embeddings, ACL, MySQL o Qdrant. La fuente Drive solo será responsable de descubrimiento, descarga, metadatos, hash y normalización.

## 8. Pruebas y aceptación

Se agregarán pruebas para demostrar:

1. paginación completa y orden determinista;
2. filtro de archivos eliminados y carpetas no autorizadas;
3. lectura Markdown y PDF soportado;
4. rechazo seguro de MIME no soportado y PDF no extraíble;
5. preservación de `fileId`, versión, SHA-256, URL y metadatos;
6. token ausente o inválido sin filtración de credenciales;
7. repetición del mismo archivo como `skipped` por idempotencia;
8. versión/hash nuevo procesado una sola vez;
9. corpus inválido o sin `stable` sin mutación de MySQL/Qdrant;
10. integración con I5-B e indexación estable-only.

La prueba manual incluirá un fake offline y una ejecución autorizada contra una carpeta Drive controlada, verificando que no se crean ni modifican archivos en Drive.

## 9. Criterios de aceptación

- Un folder configurado produce inventario paginado, ordenado y trazable.
- Markdown válido puede recorrer Drive → compilador → proyección → I3.
- PDFs no soportados se omiten o fallan de forma explícita sin indexar contenido incompleto.
- Una segunda ejecución idéntica es idempotente.
- Solo documentos `stable` llegan al índice estable.
- Se preservan `fileId`, versión, SHA-256, `sourceUri`, `sourceRevision` y ACL disponible.
- No se realizan operaciones mutantes en Drive.
- Build, typecheck, pruebas enfocadas, smoke MCP y pruebas manuales documentadas pasan.

## 10. Incrementos posteriores

I5-C no implementará OAuth interactivo, extracción OCR avanzada, Google Workspace exportaciones, portal de conectores, preguntas de oro ni observabilidad/hardening de producción. Esos trabajos quedan para I5-D/I5-E.
