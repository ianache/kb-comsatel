import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AccessPrincipal } from "../domain/schemas.js";
import type { ContextEngine } from "../engine/context-engine.js";
import type { ObservabilityContext } from "../ops/observability-context.js";
import { OperationTimeoutError } from "../ops/resilience.js";
import { registerKnowledgeResources } from "./resources.js";
import { registerKnowledgeTools } from "./tools.js";

export function createMcpServer(
  engine: ContextEngine,
  principal?: AccessPrincipal,
  observability?: ObservabilityContext,
  transport: "http" | "stdio" = "stdio",
  correlationId?: string,
  operationTimeoutMs = 10_000,
): McpServer {
  const server = new McpServer({
    name: "knowledge-context-mcp",
    version: "0.1.0",
  });

  for (const tool of registerKnowledgeTools(engine, principal)) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      },
      observability === undefined
        ? tool.handler
        : instrumentToolHandler(
            tool.name,
            tool.handler,
            observability,
            transport,
            correlationId,
            operationTimeoutMs,
          ),
    );
  }

  for (const resource of registerKnowledgeResources(engine, principal)) {
    server.registerResource(
      resource.name,
      resource.template,
      resource.metadata,
      resource.read,
    );
  }

  return server;
}

export function instrumentToolHandler(
  operation: string,
  handler: (input: unknown) => Promise<CallToolResult>,
  observability: ObservabilityContext,
  transport: "http" | "stdio",
  correlationId?: string,
  operationTimeoutMs = 10_000,
): (input: unknown) => Promise<CallToolResult> {
  return async (input) => {
    const scope = observability.startOperation({
      transport,
      operation,
      correlationId,
    });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new OperationTimeoutError()),
          operationTimeoutMs,
        );
      });
      const result = await Promise.race([handler(input), deadline]);
      if (result.isError) {
        scope.failure(extractErrorCode(result));
      } else {
        scope.success();
      }
      return result;
    } catch {
      scope.failure("INTERNAL_ERROR");
      throw new Error("Internal MCP tool error");
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  };
}

function extractErrorCode(result: CallToolResult): string {
  const structured = result.structuredContent;
  if (
    typeof structured === "object" &&
    structured !== null &&
    "error" in structured &&
    typeof structured.error === "object" &&
    structured.error !== null &&
    "code" in structured.error &&
    typeof structured.error.code === "string"
  ) {
    return structured.error.code;
  }
  return "MCP_ERROR";
}
