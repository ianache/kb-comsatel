import { z } from "zod";

const logLevelSchema = z.enum(["debug", "info", "warn", "error"]);
const portSchema = z.number().int().min(1).max(65535);
const positiveIntegerSchema = z.number().int().min(1);
const hostSchema = z.enum(["127.0.0.1", "::1"], {
  error: "Health server host must be a loopback address",
});

const configSchema = z.object({
  host: hostSchema,
  port: portSchema,
  logLevel: logLevelSchema,
  httpEnabled: z.boolean(),
  httpLocalMode: z.boolean(),
  httpPort: portSchema,
  httpMaxBodyBytes: positiveIntegerSchema,
  mysqlEnabled: z.boolean(),
  mysqlUrl: z.string().url().optional(),
  mysqlPoolSize: positiveIntegerSchema,
  keycloakEnabled: z.boolean(),
  keycloakIssuer: z.string().url().optional(),
  keycloakAudience: z.string().min(1).optional(),
  keycloakAzp: z.array(z.string().min(1)),
  keycloakClockToleranceSeconds: z.number().int().min(0),
  keycloakJwksCacheSeconds: positiveIntegerSchema,
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

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("Invalid boolean configuration value");
}

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid ${name}`);
  }
  return parsed;
}

function parseStringList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const httpEnabled = parseBoolean(env.KCP_HTTP_ENABLED, false);
  const httpLocalMode = parseBoolean(env.KCP_HTTP_LOCAL_MODE, false);
  const mysqlEnabled = parseBoolean(env.KCP_MYSQL_ENABLED, false);
  const keycloakEnabled = parseBoolean(
    env.KCP_KEYCLOAK_ENABLED,
    httpEnabled && !httpLocalMode,
  );
  const keycloakIssuer = env.KCP_KEYCLOAK_ISSUER;
  const keycloakAudience = env.KCP_KEYCLOAK_AUDIENCE;

  if (mysqlEnabled && !env.KCP_MYSQL_URL) {
    throw new Error("MySQL URL is required");
  }
  if (httpEnabled && !httpLocalMode && !keycloakIssuer) {
    throw new Error("Keycloak issuer is required");
  }
  if (keycloakEnabled && !keycloakAudience) {
    throw new Error("Keycloak audience is required");
  }

  return configSchema.parse({
    host: env.KCP_HOST ?? "127.0.0.1",
    port: parsePort(env.KCP_PORT),
    logLevel: parseLogLevel(env.KCP_LOG_LEVEL),
    httpEnabled,
    httpLocalMode,
    httpPort: parsePort(env.KCP_HTTP_PORT ?? "8790"),
    httpMaxBodyBytes: parsePositiveInteger(
      env.KCP_HTTP_MAX_BODY_BYTES,
      1_048_576,
      "KCP_HTTP_MAX_BODY_BYTES",
    ),
    mysqlEnabled,
    mysqlUrl: env.KCP_MYSQL_URL,
    mysqlPoolSize: parsePositiveInteger(
      env.KCP_MYSQL_POOL_SIZE,
      10,
      "KCP_MYSQL_POOL_SIZE",
    ),
    keycloakEnabled,
    keycloakIssuer,
    keycloakAudience,
    keycloakAzp: parseStringList(env.KCP_KEYCLOAK_AZP),
    keycloakClockToleranceSeconds: parsePositiveInteger(
      env.KCP_KEYCLOAK_CLOCK_TOLERANCE_SECONDS,
      5,
      "KCP_KEYCLOAK_CLOCK_TOLERANCE_SECONDS",
    ),
    keycloakJwksCacheSeconds: parsePositiveInteger(
      env.KCP_KEYCLOAK_JWKS_CACHE_SECONDS,
      300,
      "KCP_KEYCLOAK_JWKS_CACHE_SECONDS",
    ),
  });
}
