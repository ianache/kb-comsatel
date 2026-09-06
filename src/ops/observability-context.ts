import { randomUUID } from "node:crypto";
import type { MetricsRegistry } from "./metrics-registry.js";
import type { StructuredLogger } from "./structured-logger.js";
import type { OtelProvider } from "./otel.js";

export interface OperationScope {
  success(): void;
  failure(errorCode: string): void;
  close(): void;
}

export interface ObservabilityContext {
  startOperation(input: {
    transport: "http" | "stdio" | "internal";
    operation: string;
    correlationId?: string;
  }): OperationScope;
}

export function normalizeCorrelationId(value: string | undefined): string {
  if (value === undefined || value.trim().length === 0) return randomUUID();
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (normalized.length === 0) return randomUUID();
  return normalized.slice(0, 128);
}

export function createObservabilityContext(options: {
  metrics: MetricsRegistry;
  logger: StructuredLogger;
  otel?: OtelProvider;
}): ObservabilityContext {
  return {
    startOperation: ({ transport, operation, correlationId }) => {
      const startedAt = performance.now();
      const safeCorrelationId = normalizeCorrelationId(correlationId);
      const span = options.otel?.startSpan(`mcp.${operation}`, {
        transport,
        operation,
      });
      let finished = false;

      const finish = (outcome: "success" | "error", errorCode?: string) => {
        if (finished) return;
        finished = true;
        const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
        options.metrics.increment("kcp_mcp_requests_total", {
          transport,
          operation,
          outcome,
        });
        options.metrics.observe("kcp_mcp_request_duration_ms", {
          transport,
          operation,
        }, durationMs);
        if (errorCode !== undefined) {
          options.metrics.increment("kcp_mcp_errors_total", {
            transport,
            operation,
            error_code: errorCode,
          });
        }
        options.logger.info({
          transport,
          operation,
          outcome,
          durationMs,
          correlationId: safeCorrelationId,
          ...(errorCode === undefined ? {} : { errorCode }),
        });
        span?.end();
      };

      return {
        success: () => finish("success"),
        failure: (errorCode) => finish("error", errorCode),
        close: () => finish("success"),
      };
    },
  };
}
