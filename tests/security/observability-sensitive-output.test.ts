import { describe, expect, it } from "vitest";
import { createMetricsRegistry } from "../../src/ops/metrics-registry.js";
import { createStructuredLogger } from "../../src/ops/structured-logger.js";

describe("observability sensitive output", () => {
  it("does not serialize credentials, payloads, or document content", () => {
    const lines: string[] = [];
    const logger = createStructuredLogger({
      service: "test",
      environment: "test",
      writer: { write: (line) => lines.push(line) },
    });
    const metrics = createMetricsRegistry();

    logger.error({
      transport: "http",
      operation: "search_knowledge",
      outcome: "error",
      authorization: "Bearer jwt.secret.value",
      token: "gitlab-secret-token",
      query: "private customer query",
      excerpt: "private customer document",
    });
    metrics.increment("kcp_mcp_errors_total", {
      transport: "http",
      operation: "search_knowledge",
      error_code: "INTERNAL_ERROR",
    });

    expect(`${lines.join("\n")}\n${metrics.renderPrometheus()}`).not.toMatch(
      /Bearer|jwt\.secret|gitlab-secret|private customer|password|secret/i,
    );
  });
});
