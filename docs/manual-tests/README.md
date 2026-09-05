# Pruebas manuales I2

Este directorio contiene la validación manual previa a dar por cerrado el branch I2. Las pruebas no reemplazan `npm test`; validan integración local, HTTP, autenticación, MySQL, ACL, readiness y ausencia de datos sensibles.

## Orden recomendado

1. [01 — STDIO e inventario MCP](./01-stdio-mcp.md)
2. [02 — HTTP local](./02-http-local.md)
3. [03 — HTTP con Keycloak/JWKS](./03-http-keycloak.md)
4. [04 — MySQL, migraciones y ACL](./04-mysql-acl.md)
5. [05 — Seguridad y operación](./05-security-operations.md)

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
