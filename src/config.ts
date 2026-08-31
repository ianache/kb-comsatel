import { z } from "zod";

const logLevelSchema = z.enum(["debug", "info", "warn", "error"]);
const portSchema = z.number().int().min(1).max(65535);
const hostSchema = z.enum(["127.0.0.1", "::1"], {
  error: "Health server host must be a loopback address",
});

const configSchema = z.object({
  host: hostSchema,
  port: portSchema,
  logLevel: logLevelSchema,
});

export type AppConfig = z.infer<typeof configSchema>;

function parsePort(value: string | undefined): number {
  if (value === undefined) {
    return 8787;
  }

  if (!/^\d+$/.test(value)) {
    throw new Error("Invalid KCP_PORT");
  }

  const parsedPort = Number(value);
  return portSchema.parse(parsedPort);
}

function parseLogLevel(value: string | undefined): AppConfig["logLevel"] {
  return logLevelSchema.parse(value ?? "info");
}

export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  return configSchema.parse({
    host: env.KCP_HOST ?? "127.0.0.1",
    port: parsePort(env.KCP_PORT),
    logLevel: parseLogLevel(env.KCP_LOG_LEVEL),
  });
}
