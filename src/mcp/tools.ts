import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { KcpError } from "../domain/errors.js";
import {
  artifactLineageSchema,
  buildContextPackInputSchema,
  contextPackSchema,
  knowledgeExcerptSchema,
  knowledgeFiltersSchema,
  provenanceSchema,
  searchKnowledgeResultSchema,
  staleConceptSchema,
  searchKnowledgeInputSchema,
  type AccessPrincipal,
} from "../domain/schemas.js";
import type { ContextEngine } from "../engine/context-engine.js";

export const localPrincipal: AccessPrincipal = {
  id: "local-stdio",
  roles: ["developer"],
  groups: [],
  products: ["cgo"],
  domains: ["units"],
  classifications: ["internal"],
};

const knowledgeIdInputSchema = z
  .object({
    knowledgeId: z.string().trim().min(1),
  })
  .strict();

const searchKnowledgeToolInputSchema = z
  .object({
    query: z.string(),
    filters: z.unknown().optional(),
    limit: z.number().optional(),
  })
  .strict();

const contextPackToolInputSchema = z
  .object({
    task: z.string(),
    product: z.string(),
    tokenBudget: z.number(),
    filters: knowledgeFiltersSchema,
  })
  .strict();

const staleConceptToolInputSchema = z
  .object({ filters: knowledgeFiltersSchema.optional() })
  .strict();

const permissiveToolInputSchema = z.object({}).passthrough();
const staleConceptResultSchema = z
  .object({ concepts: z.array(staleConceptSchema) })
  .strict();

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export function registerKnowledgeTools(engine: ContextEngine): {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  annotations: typeof readOnlyAnnotations;
  handler: (input: unknown) => Promise<CallToolResult>;
}[] {
  return [
    {
      name: "search_knowledge",
      description: "Search accessible knowledge with citations.",
      inputSchema: permissiveToolInputSchema,
      annotations: readOnlyAnnotations,
      handler: async (input) =>
        safeToolResult(
          "search_knowledge",
          async () =>
            engine.searchKnowledge(
              searchKnowledgeInputSchema.parse(input),
              localPrincipal,
            ),
          searchKnowledgeResultSchema,
        ),
    },
    {
      name: "get_knowledge_excerpt",
      description: "Read an accessible knowledge excerpt by ID.",
      inputSchema: permissiveToolInputSchema,
      annotations: readOnlyAnnotations,
      handler: async (input) =>
        safeToolResult(
          "get_knowledge_excerpt",
          async () => {
            const { knowledgeId } = knowledgeIdInputSchema.parse(input);
            return engine.getKnowledgeExcerpt(knowledgeId, localPrincipal);
          },
          knowledgeExcerptSchema.nullable(),
        ),
    },
    {
      name: "get_artifact_lineage",
      description: "Read accessible artifact lineage by knowledge ID.",
      inputSchema: permissiveToolInputSchema,
      annotations: readOnlyAnnotations,
      handler: async (input) =>
        safeToolResult(
          "get_artifact_lineage",
          async () => {
            const { knowledgeId } = knowledgeIdInputSchema.parse(input);
            return engine.getArtifactLineage(knowledgeId, localPrincipal);
          },
          artifactLineageSchema.nullable(),
        ),
    },
    {
      name: "build_context_pack",
      description: "Build a cited context pack for a task.",
      inputSchema: permissiveToolInputSchema,
      annotations: readOnlyAnnotations,
      handler: async (input) =>
        safeToolResult(
          "build_context_pack",
          async () =>
            engine.buildContextPack(
              buildContextPackInputSchema.parse(input),
              localPrincipal,
            ),
          contextPackSchema,
        ),
    },
    {
      name: "get_task_context",
      description: "Build a cited task context pack with issue/MR ranking.",
      inputSchema: permissiveToolInputSchema,
      annotations: readOnlyAnnotations,
      handler: async (input) =>
        safeToolResult(
          "get_task_context",
          async () =>
            engine.getTaskContext(
              buildContextPackInputSchema.parse(input),
              localPrincipal,
            ),
          contextPackSchema,
        ),
    },
    {
      name: "get_provenance",
      description: "Read accessible provenance by knowledge ID.",
      inputSchema: permissiveToolInputSchema,
      annotations: readOnlyAnnotations,
      handler: async (input) =>
        safeToolResult(
          "get_provenance",
          async () => {
            const { knowledgeId } = knowledgeIdInputSchema.parse(input);
            return engine.getProvenance(knowledgeId, localPrincipal);
          },
          provenanceSchema.nullable(),
        ),
    },
    {
      name: "list_stale_concepts",
      description: "List accessible stale knowledge concepts.",
      inputSchema: permissiveToolInputSchema,
      annotations: readOnlyAnnotations,
      handler: async (input) =>
        safeToolResult(
          "list_stale_concepts",
          async () => {
            const { filters } = staleConceptToolInputSchema.parse(input);
            return {
              concepts: await engine.listStaleConcepts(
                filters ?? {},
                localPrincipal,
              ),
            };
          },
          staleConceptResultSchema,
        ),
    },
  ];
}

async function safeToolResult(
  toolName: string,
  read: () => Promise<unknown>,
  outputSchema: z.ZodTypeAny,
): Promise<CallToolResult> {
  try {
    const structuredContent = outputSchema.parse(await read());
    return jsonToolResult(structuredContent);
  } catch (error) {
    const safeError = toSafeError(toolName, error);
    return {
      content: [{ type: "text", text: JSON.stringify(safeError) }],
      structuredContent: safeError,
      isError: true,
    };
  }
}

function jsonToolResult(structuredContent: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(structuredContent) }],
    structuredContent:
      typeof structuredContent === "object" && structuredContent !== null
        ? (structuredContent as Record<string, unknown>)
        : { value: structuredContent },
  };
}

export function toSafeError(
  toolName: string,
  error: unknown,
): { error: { code: string; message: string; correlationId?: string } } {
  if (error instanceof KcpError) {
    return { error: error.toMcpError() };
  }
  if (error instanceof z.ZodError) {
    return {
      error: {
        code: "INVALID_INPUT",
        message: `Invalid ${toolName} input`,
      },
    };
  }
  return {
    error: {
      code: "INTERNAL_ERROR",
      message: "Internal MCP tool error",
    },
  };
}
