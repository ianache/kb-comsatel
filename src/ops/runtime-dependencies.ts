import type { AppConfig } from "../config.js";
import { createSeedRepository } from "../catalog/seed.js";
import { runMigrations } from "../catalog/migrations.js";
import { createMySqlPool } from "../catalog/mysql-pool.js";
import { MySqlKnowledgeRepository } from "../catalog/mysql-repository.js";
import type { KnowledgeRepository } from "../catalog/repository.js";
import type { AuditSink } from "../engine/audit.js";
import { MemoryAuditSink } from "../engine/audit.js";
import { MySqlAuditSink } from "../engine/mysql-audit-sink.js";
import {
  KeycloakPrincipalResolver,
  type KeycloakPrincipalResolverOptions,
} from "../security/keycloak-principal-resolver.js";
import type { PrincipalResolver } from "../security/principal-resolver.js";

export interface RuntimeDependencies {
  repository: KnowledgeRepository;
  principalResolver?: PrincipalResolver;
  auditSink: AuditSink;
  close(): Promise<void>;
}

export async function createRuntimeDependencies(
  config: AppConfig,
): Promise<RuntimeDependencies> {
  const principalResolver = config.keycloakEnabled
    ? createKeycloakResolver(config)
    : undefined;
  if (!config.mysqlEnabled) {
    return {
      repository: createSeedRepository(),
      principalResolver,
      auditSink: new MemoryAuditSink(),
      close: async () => undefined,
    };
  }

  if (!config.mysqlUrl) throw new Error("MySQL URL is required");
  const executor = createMySqlPool({
    url: config.mysqlUrl,
    poolSize: config.mysqlPoolSize,
  });
  try {
    await runMigrations(executor);
    return {
      repository: new MySqlKnowledgeRepository(executor),
      auditSink: new MySqlAuditSink(executor),
      principalResolver,
      close: () => executor.close(),
    };
  } catch (error) {
    await executor.close();
    throw error;
  }
}

function createKeycloakResolver(config: AppConfig): PrincipalResolver {
  if (!config.keycloakIssuer || !config.keycloakAudience) {
    throw new Error("Keycloak configuration is incomplete");
  }
  const options: KeycloakPrincipalResolverOptions = {
    issuer: config.keycloakIssuer,
    audience: config.keycloakAudience,
    azp: config.keycloakAzp,
    clockToleranceSeconds: config.keycloakClockToleranceSeconds,
    jwksCacheSeconds: config.keycloakJwksCacheSeconds,
  };
  return new KeycloakPrincipalResolver(options);
}
