import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import type { Span } from "@opentelemetry/api";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import type { StructuredLogger } from "./structured-logger.js";

export interface SpanScope {
  end(): void;
}

export interface OtelProvider {
  readonly enabled: boolean;
  startSpan(name: string, attributes: Record<string, string>): SpanScope;
  shutdown(): Promise<void>;
}

const allowedAttributes = new Set([
  "transport",
  "operation",
  "dependency",
  "outcome",
  "errorCode",
]);

function safeAttributes(attributes: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(attributes)
      .filter(([key]) => allowedAttributes.has(key))
      .map(([key, value]) => [key, value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 128)]),
  );
}

const noopSpan: SpanScope = { end: () => undefined };

export function createOtelProvider(
  config: {
    otelEnabled: boolean;
    otelEndpoint?: string;
    otelServiceName: string;
    otelEnvironment: string;
  },
  logger: StructuredLogger,
): OtelProvider {
  if (!config.otelEnabled) {
    return {
      enabled: false,
      startSpan: () => noopSpan,
      shutdown: async () => undefined,
    };
  }

  const exporter = new OTLPTraceExporter(
    config.otelEndpoint === undefined ? undefined : { url: config.otelEndpoint },
  );
  const tracerProvider = new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  const tracer = tracerProvider.getTracer(
    config.otelServiceName,
    config.otelEnvironment,
  );

  const endSpan = (span: Span): SpanScope => ({ end: () => span.end() });

  return {
    enabled: true,
    startSpan: (name, attributes) =>
      endSpan(tracer.startSpan(name, { attributes: safeAttributes(attributes) })),
    shutdown: async () => {
      try {
        await tracerProvider.shutdown();
      } catch {
        logger.warn({
          transport: "internal",
          operation: "otel_shutdown",
          outcome: "error",
          errorCode: "OTEL_EXPORT_FAILED",
        });
      }
    },
  };
}
