import { z } from "zod";
import { SourceConfigurationError } from "./ingestion/source-errors.js";
import { GoogleDriveSourceError } from "./ingestion/google-drive-errors.js";

const logLevelSchema = z.enum(["debug", "info", "warn", "error"]);
const portSchema = z.number().int().min(1).max(65535);
const positiveIntegerSchema = z.number().int().min(1);
const nonNegativeIntegerSchema = z.number().int().min(0);
const vectorDistanceSchema = z.enum(["Cosine", "Euclid", "Dot"]);
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
  i3Enabled: z.boolean(),
  i3SourceDir: z.string().min(1),
  i3QdrantEnabled: z.boolean(),
  i3QdrantUrl: z.string().url(),
  i3QdrantCollection: z.string().min(1),
  i3VectorDimension: positiveIntegerSchema,
  i3VectorDistance: vectorDistanceSchema,
  i3EmbeddingUrl: z.string().url().optional(),
  i3EmbeddingModel: z.string().min(1),
  i3EmbeddingApiKey: z.string().optional(),
  i3EmbeddingTimeoutMs: positiveIntegerSchema,
  i3ChunkTargetChars: positiveIntegerSchema,
  i3ChunkOverlapChars: nonNegativeIntegerSchema,
  i3ChunkMaxChars: positiveIntegerSchema,
  i3VectorWeight: z.number().finite().nonnegative(),
  i3LexicalWeight: z.number().finite().nonnegative(),
  i3CandidateMultiplier: positiveIntegerSchema,
  gitlabPublicationEnabled: z.boolean(),
  gitlabBaseUrl: z.string().url(),
  gitlabProjectId: z.string().min(1).optional(),
  gitlabToken: z.string().min(1).optional(),
  gitlabBaseBranch: z.string().min(1),
  gitlabBranchPrefix: z.string().min(1),
  gitlabTimeoutMs: positiveIntegerSchema,
  gitlabSourceEnabled: z.boolean(),
  gitlabSourceBaseUrl: z.string().url(),
  gitlabSourceProjectId: z.string().min(1).optional(),
  gitlabSourceRef: z.string().min(1),
  gitlabSourceRoot: z.string(),
  gitlabSourceToken: z.string().min(1).optional(),
  gitlabSourceTimeoutMs: positiveIntegerSchema,
  googleDriveSourceEnabled: z.boolean(),
  googleDriveBaseUrl: z.string().url(),
  googleDriveFolderIds: z.array(z.string().min(1)),
  googleDriveToken: z.string().min(1).optional(),
  googleDriveTimeoutMs: positiveIntegerSchema,
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
  const i3Enabled = parseBoolean(env.KCP_I3_ENABLED, false);
  const i3QdrantEnabled = parseBoolean(env.KCP_I3_QDRANT_ENABLED, false);
  const i3EmbeddingModel = env.KCP_I3_EMBEDDING_MODEL ?? "local-test";
  const i3EmbeddingUrl = env.KCP_I3_EMBEDDING_URL;
  const i3QdrantUrl = env.KCP_I3_QDRANT_URL ?? "http://127.0.0.1:6333";
  const gitlabPublicationEnabled = parseBoolean(
    env.KCP_GITLAB_PUBLICATION_ENABLED,
    false,
  );
  const gitlabBaseUrl = env.KCP_GITLAB_BASE_URL ?? "https://gitlab.example.com";
  const gitlabSourceEnabled = parseBoolean(
    env.KCP_GITLAB_SOURCE_ENABLED,
    false,
  );
  const gitlabSourceBaseUrl = env.KCP_GITLAB_SOURCE_BASE_URL ?? gitlabBaseUrl;
  const googleDriveSourceEnabled = parseBoolean(
    env.KCP_GOOGLE_DRIVE_SOURCE_ENABLED,
    false,
  );
  const googleDriveFolderIds = parseStringList(env.KCP_GOOGLE_DRIVE_FOLDER_IDS);
  const googleDriveToken = env.KCP_GOOGLE_DRIVE_TOKEN;

  if (mysqlEnabled && !env.KCP_MYSQL_URL) {
    throw new Error("MySQL URL is required");
  }
  if (httpEnabled && !httpLocalMode && !keycloakIssuer) {
    throw new Error("Keycloak issuer is required");
  }
  if (keycloakEnabled && !keycloakAudience) {
    throw new Error("Keycloak audience is required");
  }
  if (i3Enabled && !i3QdrantEnabled) {
    throw new Error("Qdrant must be enabled");
  }
  if (i3Enabled && !mysqlEnabled) {
    throw new Error("MySQL must be enabled");
  }
  if (i3Enabled && !i3QdrantUrl) {
    throw new Error("Qdrant URL is required");
  }
  if (i3Enabled && i3EmbeddingModel !== "local-test" && !i3EmbeddingUrl) {
    throw new Error("Embedding URL is required");
  }
  if (gitlabPublicationEnabled && !env.KCP_GITLAB_PROJECT_ID) {
    throw new Error("GitLab project ID is required");
  }
  if (gitlabPublicationEnabled && !env.KCP_GITLAB_TOKEN) {
    throw new Error("GitLab token is required");
  }
  if (gitlabSourceEnabled && !env.KCP_GITLAB_SOURCE_PROJECT_ID) {
    throw new SourceConfigurationError("GitLab source project ID is required");
  }
  if (gitlabSourceEnabled && !env.KCP_GITLAB_SOURCE_TOKEN) {
    throw new SourceConfigurationError("GitLab source token is required");
  }
  if (googleDriveSourceEnabled && googleDriveFolderIds.length === 0) {
    throw new GoogleDriveSourceError(
      "DRIVE_INVALID_RESPONSE",
      "Google Drive folder IDs are required",
    );
  }
  if (googleDriveSourceEnabled && !googleDriveToken) {
    throw new GoogleDriveSourceError(
      "DRIVE_AUTH_REQUIRED",
      "Google Drive token is required",
    );
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
    i3Enabled,
    i3SourceDir: env.KCP_I3_SOURCE_DIR ?? "./fixtures/i3",
    i3QdrantEnabled,
    i3QdrantUrl,
    i3QdrantCollection: env.KCP_I3_QDRANT_COLLECTION ?? "knowledge_chunks",
    i3VectorDimension: parsePositiveInteger(
      env.KCP_I3_VECTOR_DIMENSION,
      3,
      "KCP_I3_VECTOR_DIMENSION",
    ),
    i3VectorDistance: vectorDistanceSchema.parse(
      env.KCP_I3_VECTOR_DISTANCE ?? "Cosine",
    ),
    i3EmbeddingUrl,
    i3EmbeddingModel,
    i3EmbeddingApiKey: env.KCP_I3_EMBEDDING_API_KEY,
    i3EmbeddingTimeoutMs: parsePositiveInteger(
      env.KCP_I3_EMBEDDING_TIMEOUT_MS,
      10_000,
      "KCP_I3_EMBEDDING_TIMEOUT_MS",
    ),
    i3ChunkTargetChars: parsePositiveInteger(
      env.KCP_I3_CHUNK_TARGET_CHARS,
      1_200,
      "KCP_I3_CHUNK_TARGET_CHARS",
    ),
    i3ChunkOverlapChars: parseNonNegativeInteger(
      env.KCP_I3_CHUNK_OVERLAP_CHARS,
      160,
      "KCP_I3_CHUNK_OVERLAP_CHARS",
    ),
    i3ChunkMaxChars: parsePositiveInteger(
      env.KCP_I3_CHUNK_MAX_CHARS,
      1_800,
      "KCP_I3_CHUNK_MAX_CHARS",
    ),
    i3VectorWeight: parseNonNegativeNumber(
      env.KCP_I3_VECTOR_WEIGHT,
      0.65,
      "KCP_I3_VECTOR_WEIGHT",
    ),
    i3LexicalWeight: parseNonNegativeNumber(
      env.KCP_I3_LEXICAL_WEIGHT,
      0.35,
      "KCP_I3_LEXICAL_WEIGHT",
    ),
    i3CandidateMultiplier: parsePositiveInteger(
      env.KCP_I3_CANDIDATE_MULTIPLIER,
      3,
      "KCP_I3_CANDIDATE_MULTIPLIER",
    ),
    gitlabPublicationEnabled,
    gitlabBaseUrl,
    gitlabProjectId: env.KCP_GITLAB_PROJECT_ID,
    gitlabToken: env.KCP_GITLAB_TOKEN,
    gitlabBaseBranch: env.KCP_GITLAB_BASE_BRANCH ?? "main",
    gitlabBranchPrefix: env.KCP_GITLAB_BRANCH_PREFIX ?? "knowledge/proposal",
    gitlabTimeoutMs: parsePositiveInteger(
      env.KCP_GITLAB_TIMEOUT_MS,
      10_000,
      "KCP_GITLAB_TIMEOUT_MS",
    ),
    gitlabSourceEnabled,
    gitlabSourceBaseUrl,
    gitlabSourceProjectId: env.KCP_GITLAB_SOURCE_PROJECT_ID,
    gitlabSourceRef: env.KCP_GITLAB_SOURCE_REF ?? "main",
    gitlabSourceRoot: env.KCP_GITLAB_SOURCE_ROOT ?? "",
    gitlabSourceToken: env.KCP_GITLAB_SOURCE_TOKEN,
    gitlabSourceTimeoutMs: parsePositiveInteger(
      env.KCP_GITLAB_SOURCE_TIMEOUT_MS,
      10_000,
      "KCP_GITLAB_SOURCE_TIMEOUT_MS",
    ),
    googleDriveSourceEnabled,
    googleDriveBaseUrl:
      env.KCP_GOOGLE_DRIVE_BASE_URL ?? "https://www.googleapis.com/drive/v3",
    googleDriveFolderIds,
    googleDriveToken,
    googleDriveTimeoutMs: parsePositiveInteger(
      env.KCP_GOOGLE_DRIVE_TIMEOUT_MS,
      10_000,
      "KCP_GOOGLE_DRIVE_TIMEOUT_MS",
    ),
  });
}

function parseNonNegativeInteger(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid ${name}`);
  }
  return parsed;
}

function parseNonNegativeNumber(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid ${name}`);
  }
  return parsed;
}
