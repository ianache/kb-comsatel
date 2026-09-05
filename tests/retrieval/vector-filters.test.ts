import { expect, it } from "vitest";
import { buildVectorFilter } from "../../src/retrieval/vector-filters.js";

it("builds bounded Qdrant filters from the access principal", () => {
  const filter = buildVectorFilter({
    id: "user-1",
    roles: ["reviewer"],
    groups: ["architecture-reviewers"],
    products: ["cgo"],
    domains: ["units"],
    classifications: ["internal"],
  });

  expect(filter).toEqual({
    must: [
      {
        key: "status",
        match: { any: ["stable", "draft", "deprecated", "superseded"] },
      },
      { key: "product", match: { any: ["cgo"] } },
      { key: "domain", match: { any: ["units"] } },
      { key: "classification", match: { any: ["internal"] } },
    ],
  });
  expect(JSON.stringify(filter)).not.toContain("user-1");
  expect(JSON.stringify(filter)).not.toContain("architecture-reviewers");
});

it("allows an explicit stale status filter without making stale the default", () => {
  const filter = buildVectorFilter(
    {
      id: "user-1",
      roles: [],
      groups: [],
      products: [],
      domains: [],
      classifications: [],
    },
    { status: ["stale"] },
  );

  expect(filter.must[0]).toEqual({ key: "status", match: { any: ["stale"] } });
});
