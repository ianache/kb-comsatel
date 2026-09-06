import { createServer } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  createHealthServer,
  type HealthServer,
} from "../../src/ops/health-server.js";
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

      server.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }

        resolve(address.port);
      });
    });
  });
}

afterEach(async () => {
  await healthServer?.close();
  healthServer = undefined;
});

describe("health server", () => {
  it("returns a healthy response", async () => {
    const port = await getAvailablePort();
    healthServer = await createHealthServer({
      host: "127.0.0.1",
      port,
      isReady: () => false,
      metrics: createMetricsRegistry(),
      logger: createStructuredLogger({ service: "test", environment: "test" }),
    });

    const response = await fetch(`http://127.0.0.1:${port}/health`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("exposes only the configured GET health routes", async () => {
    const port = await getAvailablePort();
    healthServer = await createHealthServer({
      host: "127.0.0.1",
      port,
      isReady: () => true,
      metrics: createMetricsRegistry(),
      logger: createStructuredLogger({ service: "test", environment: "test" }),
    });

    const headResponse = await fetch(`http://127.0.0.1:${port}/health`, {
      method: "HEAD",
    });
    const unknownRouteResponse = await fetch(
      `http://127.0.0.1:${port}/unknown`,
    );

    expect(headResponse.status).toBe(404);
    expect(unknownRouteResponse.status).toBe(404);
  });

  it("rejects non-loopback hosts", async () => {
    const port = await getAvailablePort();
    let invalidServer: HealthServer | undefined;

    try {
      invalidServer = await createHealthServer({
        host: "0.0.0.0",
        port,
        isReady: () => true,
        metrics: createMetricsRegistry(),
        logger: createStructuredLogger({ service: "test", environment: "test" }),
      });
    } catch (error) {
      expect(error).toHaveProperty(
        "message",
        "Health server host must be a loopback address",
      );
      return;
    } finally {
      await invalidServer?.close();
    }

    expect.fail("Expected non-loopback host rejection");
  });

  it("reports readiness after initialization", async () => {
    let isReady = false;
    const port = await getAvailablePort();
    healthServer = await createHealthServer({
      host: "127.0.0.1",
      port,
      isReady: () => isReady,
      metrics: createMetricsRegistry(),
      logger: createStructuredLogger({ service: "test", environment: "test" }),
    });

    const beforeInitialization = await fetch(`http://127.0.0.1:${port}/ready`);
    expect(beforeInitialization.status).toBe(503);
    await expect(beforeInitialization.json()).resolves.toEqual({
      status: "not_ready",
    });

    isReady = true;

    const afterInitialization = await fetch(`http://127.0.0.1:${port}/ready`);
    expect(afterInitialization.status).toBe(200);
    await expect(afterInitialization.json()).resolves.toEqual({
      status: "ready",
    });
  });
});
