import { describe, expect, it } from "vitest";
import { createMetricsRegistry } from "../../src/ops/metrics-registry.js";

describe("I5-E2 metrics", () => {
  it("renders bounded resilience and admission metrics", () => {
    const metrics = createMetricsRegistry();
    metrics.increment("kcp_resilience_events_total", {
      dependency: "gitlab",
      event: "egress_denied",
    });
    metrics.increment("kcp_http_admission_total", {
      outcome: "rejected",
      reason: "rate_limit",
    });
    metrics.set("kcp_http_inflight", { identity_class: "principal" }, 2);

    const output = metrics.renderPrometheus();
    expect(output).toContain("kcp_resilience_events_total");
    expect(output).toContain('dependency="gitlab"');
    expect(output).toContain('event="egress_denied"');
    expect(output).toContain("kcp_http_admission_total");
    expect(output).toContain("kcp_http_inflight");
  });

  it("rejects unbounded labels", () => {
    const metrics = createMetricsRegistry();
    expect(() =>
      metrics.increment("kcp_resilience_events_total", {
        dependency: "https://secret.example/?token=hidden",
        event: "failure",
      }),
    ).toThrow("Unsafe metric label");
  });
});
