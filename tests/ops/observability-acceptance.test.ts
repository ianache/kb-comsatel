import { createServer } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createHealthServer, type HealthServer } from "../../src/ops/health-server.js";
import { createMetricsRegistry } from "../../src/ops/metrics-registry.js";
import { createObservabilityContext } from "../../src/ops/observability-context.js";
import { createStructuredLogger } from "../../src/ops/structured-logger.js";

let server: HealthServer | undefined;

async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address === null || typeof address === "string") {
        probe.close(() => reject(new Error("Expected a TCP address")));
        return;
      }
      probe.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe("I5-E1 observability acceptance", () => {
  it("serves health, readiness and metrics after an instrumented operation", async () => {
    const metrics = createMetricsRegistry();
    const context = createObservabilityContext({
      metrics,
      logger: createStructuredLogger({ service: "test", environment: "local" }),
    });
    const port = await availablePort();
    server = await createHealthServer({
      host: "127.0.0.1",
      port,
      isReady: () => true,
      metrics,
      logger: createStructuredLogger({ service: "test", environment: "local" }),
    });

    const scope = context.startOperation({
      transport: "http",
      operation: "search_knowledge",
      correlationId: "acceptance-123",
    });
    scope.success();

    await expect(fetch(`http://127.0.0.1:${port}/health`)).resolves.toHaveProperty("status", 200);
    await expect(fetch(`http://127.0.0.1:${port}/ready`)).resolves.toHaveProperty("status", 200);
    const metricsResponse = await fetch(`http://127.0.0.1:${port}/metrics`);
    const metricsBody = await metricsResponse.text();

    expect(metricsResponse.status).toBe(200);
    expect(metricsBody).toContain("kcp_mcp_requests_total");
    expect(metricsBody).toContain('operation="search_knowledge"');
    expect(metricsBody).not.toContain("acceptance-123");
  });
});
