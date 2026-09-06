import { describe, expect, it } from "vitest";
import {
  createMetricsRegistry,
  type MetricsRegistry,
} from "../../src/ops/metrics-registry.js";

describe("metrics registry", () => {
  it("renders bounded request counters and duration histograms", () => {
    const registry: MetricsRegistry = createMetricsRegistry();

    registry.increment("kcp_mcp_requests_total", {
      transport: "http",
      operation: "search_knowledge",
      outcome: "success",
    });
    registry.observe(
      "kcp_mcp_request_duration_ms",
      { transport: "http", operation: "search_knowledge" },
      12,
    );

    const output = registry.renderPrometheus();

    expect(output).toContain(
      'kcp_mcp_requests_total{operation="search_knowledge",outcome="success",transport="http"} 1',
    );
    expect(output).toContain(
      'kcp_mcp_request_duration_ms_count{operation="search_knowledge",transport="http"} 1',
    );
    expect(output).toContain("# TYPE kcp_mcp_requests_total counter");
  });

  it("rejects unknown metrics and free-form labels", () => {
    const registry = createMetricsRegistry();

    expect(() =>
      registry.increment("not_allowed", { operation: "search_knowledge" }),
    ).toThrow("Unknown metric");
    expect(() =>
      registry.increment("kcp_mcp_requests_total", {
        transport: "http",
        operation: "search_knowledge",
        outcome: "success",
        query: "premium unit",
      } as never),
    ).toThrow("Unknown label");
  });
});
