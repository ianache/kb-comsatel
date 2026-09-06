# Pruebas manuales I1, I2 e I3

Este directorio contiene la validación manual del proyecto. Las pruebas no reemplazan `npm test`; validan integración local, HTTP, autenticación, MySQL, ACL, readiness, ingesta/indexación y ausencia de datos sensibles.

## Orden recomendado

1. [01 — STDIO e inventario MCP](./01-stdio-mcp.md)
2. [02 — HTTP local](./02-http-local.md)
3. [03 — HTTP con Keycloak/JWKS](./03-http-keycloak.md)
4. [04 — MySQL, migraciones y ACL](./04-mysql-acl.md)
5. [05 — Seguridad y operación](./05-security-operations.md)
6. [06 - I3 ingesta e indexacion](./06-i3-ingestion-indexing.md)
7. [Manual I3 - busqueda hibrida](./i3-hybrid-retrieval.md)
8. [07 - I4-A Knowledge Compiler OKF](./07-i4a-okf-compiler.md)
9. [08 - I4-B publicación OKF mediante GitLab](./08-i4b-gitlab-publication.md)
10. [09 - I5-A ingesta OKF desde GitLab](./09-i5a-gitlab-source-ingestion.md)
11. [10 - I5-B indexación OKF remoto desde GitLab](./10-i5b-gitlab-source-indexing.md)
12. [11 - I5-C ingesta read-only desde Google Drive](./11-i5c-google-drive-source.md)
15. [14 - I5-D validación con MCP Inspector](./14-mcp-inspector.md)
14. [13 - I5-D guía manual para los seis casos con timeout](./13-i5d-timeout-cases.md)
13. [12 - I5-D evaluación piloto con preguntas de oro](./12-i5d-golden-evaluation.md)

## Criterio de aprobación

Cada caso debe terminar con el resultado esperado y evidencia guardada en el ticket o MR: salida de comandos, respuesta HTTP sanitizada, timestamp, versión del commit probado y, cuando corresponda, captura de `/ready` y consulta de auditoría.

No copiar tokens, contraseñas, JWT completos, prompts ni contenido completo de documentos en la evidencia.

## Preparación común

Desde la raíz del proyecto:

```powershell
npm ci
npm run build
npm test
```

Usar dos terminales para los escenarios HTTP: una para el servidor y otra para las llamadas. Los puertos por defecto son `8787` para health/readiness y `8790` para MCP HTTP.

Para los casos I3, levantar adicionalmente MySQL y Qdrant y configurar `KCP_I3_ENABLED=true`. El caso 06 cubre ingesta e indexacion; el documento I3 cubre busqueda hibrida, ACL, incompatibilidad de coleccion y fallback lexical.
