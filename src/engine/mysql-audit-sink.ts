import { KcpError } from "../domain/errors.js";
import type { SqlExecutor } from "../catalog/sql-executor.js";
import type { AuditEvent, AuditSink } from "./audit.js";

const insertAuditEventSql = `
  INSERT INTO knowledge_audit_events
    (correlation_id, principal_id, operation, filter_keys, result_count,
     authorization, evidence_status, latency_ms, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`;

export class MySqlAuditSink implements AuditSink {
  constructor(private readonly executor: SqlExecutor) {}

  async record(event: AuditEvent): Promise<void> {
    if (!Number.isFinite(event.latencyMs) || event.latencyMs < 0) {
      throw new KcpError(INTERNAL_ERROR, "Invalid audit event latency");
    }
    if (!Number.isInteger(event.resultCount) || event.resultCount < 0) {
      throw new KcpError(INTERNAL_ERROR, "Invalid audit event result count");
    }

    try {
      await this.executor.execute(insertAuditEventSql, [
        event.correlationId,
        event.principalId,
        event.operation,
        JSON.stringify(event.filterKeys),
        event.resultCount,
        event.authorization,
        event.evidenceStatus,
        Math.round(event.latencyMs),
      ]);
    } catch {
      throw new KcpError(INTERNAL_ERROR, "Audit persistence unavailable");
    }
  }
}

const INTERNAL_ERROR = "INTERNAL_ERROR" as const;
