import type { AccessPrincipal } from "../domain/schemas.js";

export interface VectorFilter {
  must: Array<{ key: string; match: { any: string[] } }>;
}

export function buildVectorFilter(principal: AccessPrincipal): VectorFilter {
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
  return { must };
}
