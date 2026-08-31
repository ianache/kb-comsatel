import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";

let transport: StdioClientTransport | undefined;
let client: Client | undefined;
let stderr: string[] = [];

async function connectClient(): Promise<Client> {
  client = new Client({
    name: "knowledge-context-mcp-contract-test",
    version: "1.0.0",
  });
  transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/server.js", "--stdio"],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  transport.stderr?.on("data", (chunk: Buffer) => {
    stderr.push(chunk.toString());
  });
  await client.connect(transport);
  return client;
}

afterEach(async () => {
  try {
    await client?.close();
  } catch (error) {
    throw new Error(`${String(error)}\n${stderr.join("")}`);
  }
  client = undefined;
  transport = undefined;
  stderr = [];
});

describe("MCP stdio contract", () => {
  it("exposes read-only knowledge tools and resource templates", async () => {
    const mcpClient = await connectClient();

    const tools = await mcpClient.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      "build_context_pack",
      "get_artifact_lineage",
      "get_knowledge_excerpt",
      "get_provenance",
      "get_task_context",
      "list_stale_concepts",
      "search_knowledge",
    ]);
    expect(
      tools.tools.every((tool) => tool.annotations?.readOnlyHint === true),
    ).toBe(true);

    const resourceTemplates = await mcpClient.listResourceTemplates();
    expect(
      resourceTemplates.resourceTemplates
        .map((template) => template.uriTemplate)
        .sort(),
    ).toEqual([
      "km://artifact/{knowledge_id}",
      "km://artifact/{knowledge_id}/version/{revision}",
      "km://taxonomy/{domain}",
    ]);
  });

  it("returns cited search evidence for the public seed catalog", async () => {
    const mcpClient = await connectClient();

    const result = await mcpClient.callTool(
      {
        name: "search_knowledge",
        arguments: {
          query: "premium unit",
          limit: 8,
        },
      },
      CallToolResultSchema,
    );

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      evidenceStatus: "sufficient",
      appliedFilters: {},
    });
    const structuredContent = result.structuredContent as {
      results: Array<{
        citation?: { knowledgeId?: string; sourceUri?: string };
      }>;
    };
    expect(structuredContent.results[0]?.citation).toMatchObject({
      knowledgeId: "artifact-public-unit-rule",
      sourceUri: "https://gitlab.example.com/cgo/units/rules/premium-unit",
    });
  });

  it("returns a structured invalid-input error for invalid search limits", async () => {
    const mcpClient = await connectClient();

    const result = await mcpClient.callTool(
      {
        name: "search_knowledge",
        arguments: {
          query: "premium unit",
          limit: 21,
        },
      },
      CallToolResultSchema,
    );

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      error: {
        code: "INVALID_INPUT",
        message: "Invalid search_knowledge input",
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/stack|secret|token|jwt/i);
  });

  it("returns structured safe errors for invalid resource inputs", async () => {
    const mcpClient = await connectClient();

    const result = await mcpClient.readResource({
      uri: "km://taxonomy/%20",
    });

    expect(result.contents).toHaveLength(1);
    const content = result.contents[0];
    expect(content?.mimeType).toBe("application/json");
    expect(
      content && "text" in content ? JSON.parse(content.text) : null,
    ).toEqual({
      error: {
        code: "INVALID_INPUT",
        message: "Invalid taxonomy resource input",
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/stack|secret|token|jwt/i);
  });

  it("returns taxonomy data by domain", async () => {
    const mcpClient = await connectClient();

    const result = await mcpClient.readResource({
      uri: "km://taxonomy/units",
    });

    const content = result.contents[0];
    expect(
      content && "text" in content ? JSON.parse(content.text) : null,
    ).toEqual({
      product: "cgo",
      domain: "units",
      artifactTypes: ["rule", "architecture-decision", "delivery-procedure"],
      concepts: ["premium-unit", "unit-identifier", "delivery"],
    });
  });

  it("returns only the exact requested artifact revision", async () => {
    const mcpClient = await connectClient();

    const matching = await mcpClient.readResource({
      uri: "km://artifact/artifact-public-unit-rule/version/a1b2c3d4",
    });
    const matchingContent = matching.contents[0];
    expect(
      matchingContent && "text" in matchingContent
        ? JSON.parse(matchingContent.text)
        : null,
    ).toMatchObject({
      knowledgeId: "artifact-public-unit-rule",
      sourceRevision: "a1b2c3d4",
    });

    const mismatch = await mcpClient.readResource({
      uri: "km://artifact/artifact-public-unit-rule/version/other",
    });
    const mismatchContent = mismatch.contents[0];
    expect(
      mismatchContent && "text" in mismatchContent
        ? JSON.parse(mismatchContent.text)
        : null,
    ).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "Knowledge artifact revision not found",
      },
    });
  });

  it("normalizes missing tool inputs instead of returning an SDK error", async () => {
    const mcpClient = await connectClient();

    const result = await mcpClient.callTool(
      { name: "search_knowledge", arguments: { limit: 8 } },
      CallToolResultSchema,
    );

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      error: {
        code: "INVALID_INPUT",
        message: "Invalid search_knowledge input",
      },
    });
  });

  it("passes stale filters through the public tool", async () => {
    const mcpClient = await connectClient();

    const result = await mcpClient.callTool(
      {
        name: "list_stale_concepts",
        arguments: { filters: { status: ["superseded"] } },
      },
      CallToolResultSchema,
    );

    expect(result.structuredContent).toMatchObject({
      concepts: [{ knowledgeId: "artifact-superseded-delivery" }],
    });
  });

  it("requires context-pack filters in the public input", async () => {
    const mcpClient = await connectClient();

    const result = await mcpClient.callTool(
      {
        name: "build_context_pack",
        arguments: {
          task: "premium unit rules",
          product: "cgo",
          tokenBudget: 500,
        },
      },
      CallToolResultSchema,
    );

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      error: {
        code: "INVALID_INPUT",
        message: "Invalid build_context_pack input",
      },
    });
  });
});
