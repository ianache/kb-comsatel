import { createServer } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createHealthServer, type HealthServer } from "../../src/ops/health-server.js";
import { createMetricsRegistry } from "../../src/ops/metrics-registry.js";
import { createStructuredLogger } from "../../src/ops/structured-logger.js";

let healthServer: HealthServer | undefined;

async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close(() => reject(new Error("Expected a TCP address")));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

afterEach(async () => {
  await healthServer?.close();
  healthServer = undefined;
});

describe("metrics endpoint", () => {
  it("returns Prometheus metrics without sensitive content", async () => {
    const port = await getAvailablePort();
    const metrics = createMetricsRegistry();
    metrics.increment("kcp_mcp_requests_total", {
      transport: "http",
      operation: "search_knowledge",
      outcome: "success",
    });
    healthServer = await createHealthServer({
      host: "127.0.0.1",
      port,
      isReady: () => true,
      metrics,
      logger: createStructuredLogger({
        service: "test",
        environment: "test",
        writer: { write: () => undefined },
      }),
    });

    const response = await fetch(`http://127.0.0.1:${port}/metrics`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(body).toContain("kcp_mcp_requests_total");
    expect(body).not.toMatch(/secret|token|jwt|Bearer|premium unit/i);
  });
});
