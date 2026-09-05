import { describe, expect, it } from "vitest";
import { createHttpMcpServer } from "../../src/mcp/http-server.js";
import { localPrincipal } from "../../src/mcp/tools.js";
import type { ContextEngine } from "../../src/engine/context-engine.js";

describe("HTTP MCP contract", () => {
  it("rejects HTTP MCP requests without a bearer token", async () => {
    const server = createHttpMcpServer({
      host: "127.0.0.1",
      port: 0,
      maxBodyBytes: 1024 * 1024,
      engine: {} as ContextEngine,
      principalResolver: { resolve: async () => localPrincipal },
    });
    try {
      const response = await server.app.inject({
        method: "POST",
        url: "/mcp",
        payload: {},
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({
        error: { code: "UNAUTHORIZED", message: "Authentication required" },
      });
    } finally {
      await server.close();
    }
  });

  it("keeps readiness outside the MCP endpoint", async () => {
    const server = createHttpMcpServer({
      host: "127.0.0.1",
      port: 0,
      maxBodyBytes: 1024 * 1024,
      engine: {} as ContextEngine,
      localPrincipal,
    });
    try {
      const response = await server.app.inject({ method: "GET", url: "/mcp" });
      expect(response.statusCode).toBe(405);
      expect(response.headers.allow).toBe("POST");
    } finally {
      await server.close();
    }
  });
});
