import { describe, expect, it } from "vitest";
import { createHttpMcpServer } from "../../src/mcp/http-server.js";
import { AdmissionRejectedError } from "../../src/mcp/admission-control.js";
import { localPrincipal } from "../../src/mcp/tools.js";
import type { ContextEngine } from "../../src/engine/context-engine.js";

function rejectedServer(statusCode: 429 | 503) {
  return createHttpMcpServer({
    host: "127.0.0.1",
    port: 0,
    maxBodyBytes: 1024 * 1024,
    engine: {} as ContextEngine,
    localPrincipal,
    admissionControl: {
      admit: () => new AdmissionRejectedError(
        statusCode,
        statusCode === 429 ? 2 : 1,
        statusCode === 429 ? "rate_limit" : "concurrency",
      ),
      release: () => undefined,
    },
  });
}

describe("HTTP resilience contract", () => {
  it("returns 429 and Retry-After for rate limiting", async () => {
    const server = rejectedServer(429);
    try {
      const response = await server.app.inject({ method: "POST", url: "/mcp", payload: {} });
      expect(response.statusCode).toBe(429);
      expect(response.headers["retry-after"]).toBe("2");
      expect(response.json()).toEqual({
        error: { code: "RATE_LIMITED", message: "Request rate limit exceeded" },
      });
    } finally {
      await server.close();
    }
  });

  it("returns 503 and Retry-After for concurrency saturation", async () => {
    const server = rejectedServer(503);
    try {
      const response = await server.app.inject({ method: "POST", url: "/mcp", payload: {} });
      expect(response.statusCode).toBe(503);
      expect(response.headers["retry-after"]).toBe("1");
      expect(response.json().error.code).toBe("CONCURRENCY_LIMITED");
    } finally {
      await server.close();
    }
  });
});
