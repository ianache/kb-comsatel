import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ContextEngine } from "../engine/context-engine.js";
import { registerKnowledgeResources } from "./resources.js";
import { registerKnowledgeTools } from "./tools.js";

export function createMcpServer(engine: ContextEngine): McpServer {
  const server = new McpServer({
    name: "knowledge-context-mcp",
    version: "0.1.0",
  });

  for (const tool of registerKnowledgeTools(engine)) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      },
      tool.handler,
    );
  }

  for (const resource of registerKnowledgeResources(engine)) {
    server.registerResource(
      resource.name,
      resource.template,
      resource.metadata,
      resource.read,
    );
  }

  return server;
}
