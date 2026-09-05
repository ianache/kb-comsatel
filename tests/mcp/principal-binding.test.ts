import { expect, it } from "vitest";
import { registerKnowledgeResources } from "../../src/mcp/resources.js";
import { registerKnowledgeTools } from "../../src/mcp/tools.js";
import type { AccessPrincipal } from "../../src/domain/schemas.js";
import type { ContextEngine } from "../../src/engine/context-engine.js";

const authenticatedPrincipal: AccessPrincipal = {
  id: "http-user",
  roles: ["reviewer"],
  groups: ["architecture-reviewers"],
  products: ["cgo"],
  domains: ["units"],
  classifications: ["internal"],
};

it("passes the supplied principal to tool handlers", async () => {
  let observed: AccessPrincipal | undefined;
  const engine = {
    searchKnowledge: async (_input: unknown, principal: AccessPrincipal) => {
      observed = principal;
      return {
        results: [],
        appliedFilters: {},
        evidenceStatus: "insufficient",
        warnings: [],
      };
    },
  } as unknown as ContextEngine;
  const tool = registerKnowledgeTools(engine, authenticatedPrincipal).find(
    (item) => item.name === "search_knowledge",
  );

  await tool!.handler({ query: "restricted" });
  expect(observed).toEqual(authenticatedPrincipal);
});

it("keeps the public MCP registration names and URI templates unchanged", () => {
  const engine = {} as ContextEngine;
  const tools = registerKnowledgeTools(engine, authenticatedPrincipal);
  const resources = registerKnowledgeResources(engine, authenticatedPrincipal);
  expect(tools.map((tool) => tool.name)).toEqual([
    "search_knowledge",
    "get_knowledge_excerpt",
    "get_artifact_lineage",
    "build_context_pack",
    "get_task_context",
    "get_provenance",
    "list_stale_concepts",
  ]);
  expect(
    resources.map((resource) => resource.template.uriTemplate.template),
  ).toEqual([
    "km://artifact/{knowledge_id}",
    "km://artifact/{knowledge_id}/version/{revision}",
    "km://taxonomy/{domain}",
  ]);
});
