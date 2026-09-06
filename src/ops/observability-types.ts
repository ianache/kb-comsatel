export type MetricLabels = Record<string, string>;

export type LogOutcome = "success" | "error" | "denied";

export interface SafeLogEvent {
  transport: "http" | "stdio" | "internal";
  operation: string;
  outcome: LogOutcome;
  durationMs?: number;
  correlationId?: string;
  errorCode?: string;
}

export interface ObservabilityOptions {
  otelEnabled: boolean;
  otelEndpoint?: string;
  otelServiceName: string;
  otelEnvironment: string;
}
