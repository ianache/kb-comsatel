import type { AccessPrincipal, KnowledgeFilters } from "../domain/schemas.js";

export interface VectorFilter {
  must: Array<{ key: string; match: { any: string[] } }>;
}

export function buildVectorFilter(
  principal: AccessPrincipal,
  filters: KnowledgeFilters = {},
): VectorFilter {
  const must: VectorFilter["must"] = [
    {
      key: "status",
      match: { any: ["stable", "draft", "deprecated", "superseded"] },
    },
  ];
  if (principal.products.length > 0) {
    must.push({ key: "product", match: { any: principal.products } });
  }
  if (principal.domains.length > 0) {
    must.push({ key: "domain", match: { any: principal.domains } });
  }
  if (principal.classifications.length > 0) {
    must.push({
      key: "classification",
      match: { any: principal.classifications },
    });
  }
  const addFilter = (key: string, values: string[] | undefined) => {
    if (values && values.length > 0) must.push({ key, match: { any: values } });
  };
  addFilter("product", filters.product);
  addFilter("domain", filters.domain);
  addFilter("artifact_type", filters.artifactType);
  addFilter("status", filters.status);
  addFilter("source_system", filters.sourceSystem);
  return { must };
}
