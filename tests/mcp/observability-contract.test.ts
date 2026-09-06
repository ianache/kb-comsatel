import { describe, expect, it } from "vitest";
import { createMetricsRegistry } from "../../src/ops/metrics-registry.js";
import { instrumentToolHandler } from "../../src/mcp/adapter.js";
import {
  createObservabilityContext,
  normalizeCorrelationId,
} from "../../src/ops/observability-context.js";
import { createStructuredLogger } from "../../src/ops/structured-logger.js";

describe("MCP observability contract", () => {
  it("records successful and failed operations without correlation labels", () => {
    const metrics = createMetricsRegistry();
    const lines: string[] = [];
    const logger = createStructuredLogger({
      service: "test",
      environment: "test",
      writer: { write: (line) => lines.push(line) },
    });
    const context = createObservabilityContext({ metrics, logger });

    const success = context.startOperation({
      transport: "http",
      operation: "search_knowledge",
      correlationId: "corr-success",
    });
    success.success();

    const failure = context.startOperation({
      transport: "stdio",
      operation: "search_knowledge",
      correlationId: "corr-failure",
    });
    failure.failure("INVALID_INPUT");

    const output = metrics.renderPrometheus();
    expect(output).toContain('outcome="success"');
    expect(output).toContain('outcome="error"');
    expect(output).toContain('error_code="INVALID_INPUT"');
    expect(output).not.toContain("corr-success");
    expect(output).not.toContain("corr-failure");
    expect(lines.join("\n")).toContain("corr-success");
    expect(lines.join("\n")).toContain("corr-failure");
  });

  it("normalizes invalid incoming correlation IDs", () => {
    expect(normalizeCorrelationId("corr\nunsafe")).toBe("corr unsafe");
    expect(normalizeCorrelationId("x".repeat(129))).not.toBe("x".repeat(129));
    expect(normalizeCorrelationId(undefined)).toMatch(
      /^[0-9a-f-]{36}$/,
    );
  });

  it("instruments a tool handler without changing its result", async () => {
    const metrics = createMetricsRegistry();
    const context = createObservabilityContext({
      metrics,
      logger: createStructuredLogger({ service: "test", environment: "test" }),
    });
    const result = { content: [{ type: "text" as const, text: "ok" }] };

    await expect(
      instrumentToolHandler(
        "search_knowledge",
        async () => result,
        context,
        "http",
        "corr-http",
      )({}),
    ).resolves.toEqual(result);
    expect(metrics.renderPrometheus()).toContain(
      'kcp_mcp_requests_total{operation="search_knowledge",outcome="success",transport="http"} 1',
    );
  });
});
