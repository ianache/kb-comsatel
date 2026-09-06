# I5-E2 — Resiliencia y hardening de seguridad

Fecha: 2026-09-06  
Estado: propuesta técnica aprobada para planificación  
Dependencias: I5-E1 observabilidad

## Objetivo

Cumplir NFR-04 y NFR-05 sin cambiar el contrato funcional de las herramientas MCP: limitar el abuso, evitar llamadas salientes inseguras, acotar fallos de dependencias y hacer visibles los rechazos y degradaciones.

## Alcance

1. Egress policy para todas las URLs configurables de GitLab, Google Drive, embeddings, Qdrant y OIDC.
2. Timeout por dependencia y deadline total de herramienta de 10 segundos.
3. Circuit breaker por dependencia lógica, con estados closed/open/half-open.
4. Rate limiting y límite de concurrencia por identidad en el endpoint HTTP MCP.
5. Métricas, logs sanitizados y errores estables para cada motivo de rechazo.
6. Pruebas unitarias, de integración/contrato y un manual de pruebas.

Fuera de alcance: Redis u otro rate limiter distribuido, HPA/OKE, Vault, cambios de ACL, y rediseño del transporte MCP. Estos permanecen en I5-E3 o en los incrementos funcionales correspondientes.

## Diseño propuesto

### 1. Política de egress

Crear un módulo de seguridad reutilizable que valide una URL antes de cada solicitud saliente. La política debe:

- exigir `https` para destinos configurados, permitiendo `http` únicamente cuando el entorno de desarrollo lo habilite explícitamente;
- comparar hostname contra una allowlist configurable por dependencia (`GitLab`, `Drive`, `embedding`, `Qdrant`, `OIDC`);
- resolver y rechazar loopback, rangos privados, link-local, multicast, metadata endpoints y destinos no globales;
- rechazar credenciales embebidas, puertos no permitidos y redirecciones hacia un destino que no vuelva a validar la política;
- no registrar tokens ni la URL completa cuando pueda contener datos sensibles.

La validación se hará también en el punto de request, no solamente al cargar configuración, para cubrir URLs dinámicas y redirecciones.

### 2. Resiliencia de solicitudes

Crear utilidades comunes para ejecutar solicitudes salientes con:

- `AbortSignal.timeout`/`AbortController` compatible con el runtime actual;
- deadline heredado desde la operación MCP;
- clasificación estable de timeout, circuito abierto, egress denegado y dependencia no disponible;
- limpieza garantizada de timers y señales.

Los adaptadores existentes conservarán sus errores de dominio (`auth`, `not_found`, `unavailable`) y sólo incorporarán metadatos operativos seguros.

El deadline de herramienta será 10 s por defecto y configurable para pruebas/operación. Una solicitud de dependencia nunca podrá extender el deadline restante.

### 3. Circuit breaker

Implementar un breaker en memoria por dependencia lógica. Los errores de red, timeout y respuestas 5xx cuentan como fallos; errores de validación, autorización y 4xx funcionales no abren el circuito. La configuración incluirá umbral, ventana de fallo, duración abierta y número de probes half-open.

Cuando esté abierto, la llamada fallará rápidamente con un error seguro y una métrica identificable. El estado no incluirá tokens, payloads ni URLs completas.

### 4. Rate limiting y concurrencia HTTP

Añadir un control local por identidad/principal (y una clave anónima limitada cuando no haya autenticación):

- ventana/token bucket configurable;
- límite de solicitudes en vuelo por identidad;
- respuestas `429` con `Retry-After` cuando corresponda;
- rechazo antes de crear el servidor MCP o ejecutar herramientas;
- métricas para permitidas, limitadas y rechazadas por concurrencia.

El almacenamiento local por proceso es intencional para I5-E2. La consistencia entre réplicas se resolverá en I5-E3.

### 5. Configuración segura

Agregar variables documentadas con defaults conservadores, sin romper configuraciones existentes. Las listas de allowlist deben ser explícitas; producción no debe aceptar destinos arbitrarios por defecto. El arranque debe rechazar configuraciones ambiguas o inválidas y los logs deben mostrar sólo nombres de dependencia y motivos.

## Contratos y compatibilidad

- STDIO mantiene comportamiento y salida existentes.
- HTTP conserva autenticación, `/health`, `/ready` y `/metrics`.
- Los clientes reciben errores HTTP/MCP estables (`400`, `401`, `403`, `429`, `503`, `504`) sin detalles internos.
- Los fetchers inyectados de pruebas siguen siendo soportados, pero pasan por la misma política salvo que el test declare explícitamente un bypass controlado.

## Verificación

- tests de configuración para defaults, allowlists y rechazo de valores inseguros;
- tests de SSRF para loopback, IPv4/IPv6 privadas, metadata, redirecciones y destinos permitidos;
- tests de timeout/deadline, breaker y recuperación half-open;
- tests HTTP de rate limit, concurrencia, `Retry-After` y aislamiento entre identidades;
- regresión completa: `npm test`, `npm run typecheck`, `npm run build`, `npm run smoke`, `git diff --check`;
- guía manual en `docs/manual-tests/` para inspección de 429/503/504, SSRF y métricas.

## Riesgos y mitigaciones

- Un allowlist demasiado estricto puede bloquear entornos internos: se diagnostica mediante el nombre de dependencia y hostname sanitizado, nunca mediante secretos.
- Breakers locales no coordinan réplicas: se documenta y se deja explícitamente para I5-E3.
- Los límites pueden afectar clientes legítimos: todos son configurables y se prueban con valores bajos sólo en fixtures.
