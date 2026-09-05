# 05 — Seguridad y operación

## Objetivo

Verificar límites operativos, apagado ordenado y ausencia de filtración de secretos.

## Casos

### OPS-01 — configuración insegura

Intentar arrancar con `KCP_HTTP_ENABLED=true`, `KCP_HTTP_LOCAL_MODE=false` y sin issuer/audience.

Esperado: el proceso no queda escuchando y reporta fallo de configuración seguro.

### OPS-02 — local mode explícito

Arrancar con `KCP_HTTP_LOCAL_MODE=true` y confirmar en la evidencia que se trata de un entorno local. No usar ese valor en producción.

### OPS-03 — readiness durante fallo de dependencia

Con MySQL habilitado, detener MySQL y reiniciar la aplicación. Verificar que el arranque falla o `/ready` no anuncia disponibilidad; no debe devolver `ready` con el catálogo inaccesible.

### OPS-04 — apagado

Enviar `Ctrl+C` o `SIGTERM`. Confirmar que el proceso termina, libera los puertos 8787/8790 y cierra el pool sin dejar conexiones activas.

### OPS-05 — sanitización de errores

Provocar entrada inválida, bearer inválido y una caída controlada de dependencia. Buscar en stdout/stderr y respuestas HTTP las cadenas `Authorization`, JWT completo, contraseña, SQL, prompt y extracto.

Esperado: no se imprimen secretos ni contenido completo; solo códigos/mensajes seguros y, cuando aplique, correlation ID.

### OPS-06 — límites de respuesta

Probar `limit` mayor que el máximo, `tokenBudget` inválido y filtros excesivos.

Esperado: `INVALID_INPUT`, sin consulta ilimitada ni respuesta sin citas.

## Evidencia de cierre

- commit probado;
- versión de Node/npm;
- salida de `npm test`, `npm run typecheck`, `npm run build`, `npm run format:check`;
- resultados de cada caso con timestamp;
- logs sanitizados;
- confirmación de limpieza de servicios locales.
