# I5-D — Arnés de evaluación piloto y preguntas de oro

**Estado:** Aprobado para diseño
**Fecha:** 2026-09-05
**Precede:** I5-C — ingesta read-only desde Google Drive

## 1. Objetivo

Crear un arnés reproducible para evaluar la calidad del flujo MCP sobre el corpus piloto GitLab/OKF/Google Drive ya indexado. El arnés ejecutará un conjunto versionado de preguntas de oro contra el `ContextEngine`, comprobará citas y estado de evidencia, medirá latencia y producirá un reporte seguro para Arquitectura y QA.

I5-D no cambia los siete nombres de herramientas MCP, no agrega herramientas de escritura y no conecta servicios externos de observabilidad. La observabilidad de producción y el hardening operativo quedan para I5-E.

## 2. Alcance

### Incluido

- Contrato tipado para casos de evaluación con identificador, pregunta/tarea, herramienta (`search_knowledge`, `build_context_pack` o `get_task_context`), principal, filtros, expectativas y etiquetas.
- Dataset inicial versionado con 30 preguntas de arquitectura/delivery representativas del piloto, incluyendo casos con evidencia suficiente, evidencia insuficiente, citas obligatorias, ACL y conocimiento obsoleto.
- Ejecutor offline y determinista mediante repositorio en memoria/fakes existentes; ninguna prueba requiere MySQL, Qdrant, GitLab, Drive, Keycloak ni credenciales.
- Validaciones por caso:
  - el resultado respeta el esquema MCP;
  - las respuestas con evidencia tienen al menos una cita válida;
  - las respuestas sin evidencia declaran `insufficient`;
  - los resultados no autorizados no exponen metadatos ni extractos;
  - los filtros y estado esperado se respetan;
  - el resultado es estable al repetir la misma pregunta.
- Métricas agregadas: total, pasadas, fallidas, cobertura de citas, proporción de `insufficient`, denegaciones ACL, latencia media/p95 y tasa de determinismo.
- Reportes JSON y Markdown con identificadores, métricas agregadas, códigos de fallo y latencias; no incluir preguntas completas, cuerpos documentales, tokens ni secretos en el reporte por defecto.
- CLI local `npm run eval:golden` con selección opcional de dataset/salida y código de salida distinto de cero si no se cumple el umbral.
- Pruebas automatizadas y prueba manual documentada en `docs/manual-tests/12-i5d-golden-evaluation.md`.

### Fuera de alcance

- Generación automática de preguntas mediante LLM.
- Evaluación semántica subjetiva de respuestas libres o un juez LLM.
- Promoción de contenido, escritura en GitLab/Drive o mutaciones en el catálogo.
- Prometheus, OpenTelemetry, Grafana, Loki, Tempo, rate limiting distribuido, circuit breakers y despliegue OKE; se planificarán en I5-E.
- Cambios al contrato público MCP o a los siete nombres de herramientas.

## 3. Diseño

```text
golden-cases.json
        |
        v
GoldenEvaluationRunner -- ContextEngine -- MemoryKnowledgeRepository
        |                         |
        v                         v
safe aggregate report       MemoryAuditSink
        |
        +--> JSON / Markdown + exit code
```

El runner recibirá dependencias explícitas para poder probarlo sin proceso MCP ni red. Construirá un `AccessPrincipal` por caso, invocará el método del motor correspondiente y convertirá cualquier excepción en un fallo seguro con código estable. El runner no inspeccionará internals del repositorio para decidir el resultado: las expectativas se expresarán sobre la salida pública del motor.

Cada caso tendrá una forma equivalente a:

```ts
interface GoldenEvaluationCase {
  id: string;
  tool: "search_knowledge" | "build_context_pack" | "get_task_context";
  input: Record<string, unknown>;
  principal: AccessPrincipal;
  expectations: {
    evidenceStatus: "sufficient" | "insufficient";
    minCitations?: number;
    requiredKnowledgeIds?: string[];
    forbiddenKnowledgeIds?: string[];
    expectedWarning?: "draft" | "deprecated" | "superseded" | "stale";
  };
  tags: string[];
}
```

Los casos se validarán al cargar el dataset. Los `knowledgeId` esperados deben existir en el fixture de evaluación y los tags se limitarán a un vocabulario conocido para evitar métricas inconsistentes.

## 4. Métricas y umbrales

El reporte calculará como mínimo:

| Métrica | Criterio I5-D |
|---|---:|
| Casos ejecutados | 30 |
| Casos con evidencia y cita válida | ≥ 90% de los casos etiquetados `evidence` |
| Casos `insufficient` correctamente declarados | 100% de los casos etiquetados `insufficient` |
| Aislamiento ACL | 100% de los casos etiquetados `acl-negative` |
| Repetición determinista | 100% de los casos repetibles |
| Latencia p95 local | Reportada, sin usarla como sustituto de la meta de producción |

Si el dataset se ejecuta con menos de 30 casos, el runner marcará el reporte como incompleto y devolverá código de salida no exitoso, aunque los casos individuales pasen.

## 5. Seguridad y privacidad

- El dataset usará identificadores y textos de prueba, no tokens, URLs privadas ni documentos corporativos completos.
- El reporte mostrará `caseId`, tags, códigos de resultado, knowledge IDs permitidos, conteos y latencia; no mostrará prompts/tareas completas, extractos ni headers.
- Los errores inesperados se normalizarán a códigos seguros; stack traces solo se permitirán mediante una opción local explícita que no forma parte del reporte estándar.
- El runner será read-only y no podrá cargar adaptadores HTTP ni ejecutar comandos Git/Drive.

## 6. Pruebas y aceptación

Se demostrarán:

1. dataset válido de 30 casos y rechazo de dataset malformado;
2. ejecución de las tres herramientas soportadas con fake/memory repository;
3. validación de citas, evidencia insuficiente, advertencias y ACL negativa;
4. detección de una expectativa incumplida con código y caso identificables;
5. reporte sin preguntas completas, extractos, tokens o secretos;
6. repetición idéntica con métricas y resultados deterministas;
7. código de salida exitoso solo con el mínimo de casos y umbrales cumplidos;
8. prueba manual reproducible desde PowerShell, sin servicios externos;
9. regresión de build, typecheck, suite MCP y smoke existentes.

## 7. Criterio de salida

I5-D estará completo cuando el comando de evaluación ejecute el dataset versionado de 30 casos offline, produzca reportes JSON/Markdown seguros, alcance los umbrales definidos, tenga pruebas automatizadas y manuales, y mantenga sin cambios el contrato MCP y los flujos I3/I4/I5-A/B/C.

I5-E podrá comenzar después con observabilidad y hardening operativo basados en las brechas que el reporte de I5-D haga visibles.
