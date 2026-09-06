import { describe, expect, it } from "vitest";
import {
  createStructuredLogger,
  type LogWriter,
} from "../../src/ops/structured-logger.js";

describe("structured logger", () => {
  it("writes safe JSON events and strips sensitive fields", () => {
    const lines: string[] = [];
    const writer: LogWriter = { write: (line) => lines.push(line) };
    const logger = createStructuredLogger({
      service: "knowledge-context-mcp",
      environment: "test",
      writer,
    });

    logger.info({
      transport: "http",
      operation: "search_knowledge",
      outcome: "success",
      durationMs: 12,
      correlationId: "corr-123",
      authorization: "Bearer secret-jwt",
      query: "premium unit",
      excerpt: "private document text",
    });

    expect(lines).toHaveLength(1);
    const event = JSON.parse(lines[0] as string) as Record<string, unknown>;
    expect(event).toMatchObject({
      service: "knowledge-context-mcp",
      environment: "test",
      transport: "http",
      operation: "search_knowledge",
      outcome: "success",
      durationMs: 12,
      correlationId: "corr-123",
    });
    expect(JSON.stringify(event)).not.toMatch(
      /Bearer|secret-jwt|premium unit|private document text/i,
    );
  });

  it("sanitizes control characters in correlation IDs", () => {
    const lines: string[] = [];
    const logger = createStructuredLogger({
      service: "knowledge-context-mcp",
      environment: "test",
      writer: { write: (line) => lines.push(line) },
    });

    logger.warn({
      transport: "stdio",
      operation: "search_knowledge",
      outcome: "error",
      correlationId: "corr\nunsafe",
    });

    expect(lines[0]).not.toContain("\nunsafe");
    expect(JSON.parse(lines[0] as string).correlationId).toBe("corr unsafe");
  });
});
