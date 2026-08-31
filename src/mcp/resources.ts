import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Variables } from "@modelcontextprotocol/sdk/shared/uriTemplate.js";
import type { ContextEngine } from "../engine/context-engine.js";
import { localPrincipal, toSafeError } from "./tools.js";

const missingResourceSchema = z
  .object({
    error: z.object({
      code: z.literal("NOT_FOUND"),
      message: z.string(),
    }),
  })
  .strict();
const resourceVariableSchema = z.string().trim().min(1);

export interface KnowledgeResourceRegistration {
  name: string;
  template: ResourceTemplate;
  metadata: {
    title: string;
    description: string;
    mimeType: "application/json";
  };
  read: (uri: URL, variables: Variables) => Promise<ReadResourceResult>;
}

export function registerKnowledgeResources(
  engine: ContextEngine,
): KnowledgeResourceRegistration[] {
  return [
    {
      name: "artifact",
      template: new ResourceTemplate("km://artifact/{knowledge_id}", {
        list: undefined,
      }),
      metadata: {
        title: "Knowledge artifact",
        description: "Accessible excerpt, lineage, and provenance by ID.",
        mimeType: "application/json",
      },
      read: async (uri, variables) =>
        safeResourceResult("artifact resource", uri, async () => {
          const knowledgeId = requiredVariable(variables, "knowledge_id");
          const [excerpt, lineage, provenance] = await Promise.all([
            engine.getKnowledgeExcerpt(knowledgeId, localPrincipal),
            engine.getArtifactLineage(knowledgeId, localPrincipal),
            engine.getProvenance(knowledgeId, localPrincipal),
          ]);
          return excerpt === null && lineage === null && provenance === null
            ? notFound("Knowledge artifact not found")
            : { excerpt, lineage, provenance };
        }),
    },
    {
      name: "artifact_revision",
      template: new ResourceTemplate(
        "km://artifact/{knowledge_id}/version/{revision}",
        { list: undefined },
      ),
      metadata: {
        title: "Knowledge artifact revision",
        description:
          "Accessible artifact metadata for an exact source revision.",
        mimeType: "application/json",
      },
      read: async (uri, variables) =>
        safeResourceResult("artifact_revision resource", uri, async () => {
          const knowledgeId = requiredVariable(variables, "knowledge_id");
          const revision = requiredVariable(variables, "revision");
          const artifact = await engine.getArtifact(
            knowledgeId,
            revision,
            localPrincipal,
          );
          return artifact ?? notFound("Knowledge artifact revision not found");
        }),
    },
    {
      name: "taxonomy",
      template: new ResourceTemplate("km://taxonomy/{domain}", {
        list: undefined,
      }),
      metadata: {
        title: "Knowledge taxonomy",
        description: "Accessible taxonomy evidence for a domain.",
        mimeType: "application/json",
      },
      read: async (uri, variables) =>
        safeResourceResult("taxonomy resource", uri, async () => {
          const domain = requiredVariable(variables, "domain");
          const taxonomy = await engine.getTaxonomy(domain, localPrincipal);
          return taxonomy ?? notFound("Knowledge taxonomy not found");
        }),
    },
  ];
}

async function safeResourceResult(
  resourceName: string,
  uri: URL,
  read: () => Promise<unknown>,
): Promise<ReadResourceResult> {
  try {
    return jsonResource(uri, await read());
  } catch (error) {
    return jsonResource(uri, toSafeError(resourceName, error));
  }
}

function jsonResource(uri: URL, value: unknown): ReadResourceResult {
  return {
    contents: [
      {
        uri: uri.toString(),
        mimeType: "application/json",
        text: JSON.stringify(value),
      },
    ],
  };
}

function notFound(message: string): z.infer<typeof missingResourceSchema> {
  return missingResourceSchema.parse({
    error: {
      code: "NOT_FOUND",
      message,
    },
  });
}

function requiredVariable(variables: Variables, name: string): string {
  const value = variables[name];
  const rawValue = Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
  return resourceVariableSchema.parse(decodeURIComponent(rawValue));
}
