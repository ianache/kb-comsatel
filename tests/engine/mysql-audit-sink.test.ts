import { describe, expect, it } from "vitest";
import { MySqlAuditSink } from "../../src/engine/mysql-audit-sink.js";
import type { SqlExecutor } from "../../src/catalog/sql-executor.js";
import type { AuditEvent } from "../../src/engine/audit.js";

const event: AuditEvent = {
  correlationId: "corr-1",
  principalId: "user-1",
  operation: "searchKnowledge",
  filterKeys: ["product", "domain"],
  resultCount: 2,
  authorization: "authorized",
  evidenceStatus: "sufficient",
  latencyMs: 12.4,
};

function fakeExecutor(overrides: Partial<SqlExecutor> = {}) {
  return {
    query: async () => [],
    execute: async () => undefined,
    ping: async () => undefined,
    close: async () => undefined,
    ...overrides,
  } as SqlExecutor;
}

describe("MySqlAuditSink", () => {
  it("persists only aggregate audit metadata with parameters", async () => {
    let receivedSql = "";
    let receivedParams: readonly unknown[] = [];
    const executor = fakeExecutor({
      execute: async (sql, params) => {
        receivedSql = sql;
        receivedParams = params;
      },
    });

    await new MySqlAuditSink(executor).record(event);

    expect(receivedSql).toContain("INSERT INTO knowledge_audit_events");
    expect(receivedSql.toLowerCase()).not.toMatch(
      /prompt|token|jwt|excerpt|content/,
    );
    expect(receivedSql).toContain("?");
    expect(receivedParams).toEqual([
      "corr-1",
      "user-1",
      "searchKnowledge",
      '["product","domain"]',
      2,
      "authorized",
      "sufficient",
      12,
    ]);
  });

  it("maps database failures to a safe internal error", async () => {
    const sink = new MySqlAuditSink(
      fakeExecutor({
        execute: async () => {
          throw new Error("secret");
        },
      }),
    );

    await expect(sink.record(event)).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      message: "Audit persistence unavailable",
    });
  });
});
