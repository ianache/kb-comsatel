import type { KnowledgeRepository } from "../catalog/repository.js";
import type { PrincipalResolver } from "../security/principal-resolver.js";
import type { AuditSink } from "../engine/audit.js";

export interface RuntimeDependencies {
  repository: KnowledgeRepository;
  principalResolver?: PrincipalResolver;
  auditSink: AuditSink;
  close(): Promise<void>;
}
