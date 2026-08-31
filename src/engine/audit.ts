export interface AuditEvent {
  correlationId: string;
  principalId: string;
  operation: string;
  filterKeys: string[];
  resultCount: number;
  authorization: "authorized" | "denied";
  evidenceStatus: "sufficient" | "insufficient";
  latencyMs: number;
}

export interface AuditSink {
  record(event: AuditEvent): void | Promise<void>;
}

export class MemoryAuditSink implements AuditSink {
  readonly events: AuditEvent[] = [];

  record(event: AuditEvent): void {
    this.events.push({ ...event, filterKeys: [...event.filterKeys] });
  }
}
