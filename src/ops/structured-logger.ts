import type { SafeLogEvent } from "./observability-types.js";

export interface LogWriter {
  write(line: string): void;
}

export interface StructuredLogger {
  info(event: SafeLogEvent & Record<string, unknown>): void;
  warn(event: SafeLogEvent & Record<string, unknown>): void;
  error(event: SafeLogEvent & Record<string, unknown>): void;
}

const sensitiveKeys = /authorization|cookie|jwt|password|secret|token|query|excerpt|content|body/i;

function sanitizeValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
}

function safeEvent(event: Record<string, unknown>, level: string, service: string, environment: string) {
  const safe: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    service,
    environment,
  };
  for (const [key, value] of Object.entries(event)) {
    if (!sensitiveKeys.test(key)) safe[key] = sanitizeValue(value);
  }
  return safe;
}

export function createStructuredLogger(options: {
  service: string;
  environment: string;
  writer?: LogWriter;
}): StructuredLogger {
  const writer = options.writer ?? { write: (line: string) => process.stderr.write(`${line}\n`) };
  const write = (level: string, event: Record<string, unknown>) => {
    writer.write(JSON.stringify(safeEvent(event, level, options.service, options.environment)));
  };
  return {
    info: (event) => write("info", event),
    warn: (event) => write("warn", event),
    error: (event) => write("error", event),
  };
}
