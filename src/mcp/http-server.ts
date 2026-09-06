import fastify, { type FastifyInstance } from "fastify";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { ContextEngine } from "../engine/context-engine.js";
import type { PrincipalResolver } from "../security/principal-resolver.js";
import { createMcpServer } from "./adapter.js";
import { httpErrorResponse } from "./http-errors.js";
import { resolveHttpPrincipal } from "./http-auth.js";
import type { ObservabilityContext } from "../ops/observability-context.js";

export interface HttpMcpServerOptions {
  host: string;
  port: number;
  maxBodyBytes: number;
  engine: ContextEngine;
  principalResolver?: PrincipalResolver;
  localPrincipal?: Parameters<typeof createMcpServer>[1];
  observability?: ObservabilityContext;
}

export interface HttpMcpServer {
  app: FastifyInstance;
  close(): Promise<void>;
}

export function createHttpMcpServer({
  host,
  port,
  maxBodyBytes,
  engine,
  principalResolver,
  localPrincipal,
  observability,
}: HttpMcpServerOptions): HttpMcpServer {
  if (!principalResolver && !localPrincipal) {
    throw new Error("HTTP authentication is not configured");
  }
  const app = fastify({ bodyLimit: maxBodyBytes, exposeHeadRoutes: false });

  app.post("/mcp", async (request, reply) => {
    try {
      const principal = principalResolver
        ? await resolveHttpPrincipal(
            request.headers.authorization,
            principalResolver,
          )
        : localPrincipal;
      const correlationId = request.headers["x-correlation-id"];
      const server = createMcpServer(
        engine,
        principal,
        observability,
        "http",
        typeof correlationId === "string" ? correlationId : undefined,
      );
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      await server.connect(transport);
      reply.hijack();
      await transport.handleRequest(request.raw, reply.raw, request.body);
      await transport.close();
    } catch (error) {
      if (!reply.sent) {
        const response = httpErrorResponse(error);
        return reply.code(response.statusCode).send(response.body);
      }
    }
  });

  app.get("/mcp", async (_request, reply) =>
    reply
      .code(405)
      .header("allow", "POST")
      .send({
        error: { code: "METHOD_NOT_ALLOWED", message: "Use POST /mcp" },
      }),
  );

  return {
    app,
    close: async () => {
      await app.close();
    },
  };
}

export async function listenHttpMcpServer(
  server: HttpMcpServer,
): Promise<void> {
  const address = await server.app.listen({
    host: "127.0.0.1",
    port: 0,
  });
  void address;
}
