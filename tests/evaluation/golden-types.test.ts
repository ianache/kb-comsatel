import { describe, expect, it } from "vitest";

import {
  goldenCaseSchema,
  goldenDatasetSchema,
  loadGoldenDataset,
} from "../../src/evaluation/golden-dataset.js";

const principal = {
  id: "golden-developer",
  roles: ["developer"],
  groups: [],
  products: ["cgo"],
  domains: ["units"],
  classifications: ["internal"],
};

const validCase = {
  id: "GOLDEN-001",
  tool: "search_knowledge",
  input: { query: "premium unit", limit: 8 },
  principal,
  expectations: {
    evidenceStatus: "sufficient",
    minCitations: 1,
    requiredKnowledgeIds: ["artifact-public-unit-rule"],
  },
  tags: ["evidence", "deterministic"],
};

describe("golden evaluation contracts", () => {
  it("accepts a valid case with a supported tool and expectations", () => {
    expect(goldenCaseSchema.parse(validCase)).toMatchObject({
      id: "GOLDEN-001",
      tool: "search_knowledge",
      expectations: { evidenceStatus: "sufficient" },
    });
  });

  it("rejects unsupported tools and unknown tags", () => {
    expect(
      goldenCaseSchema.safeParse({ ...validCase, tool: "mutate_knowledge" })
        .success,
    ).toBe(false);
    expect(
      goldenCaseSchema.safeParse({
        ...validCase,
        tags: ["unsupported-tag"],
      }).success,
    ).toBe(false);
  });

  it("requires exactly thirty unique cases in a dataset", () => {
    const cases = Array.from({ length: 30 }, (_, index) => ({
      ...validCase,
      id: `GOLDEN-${String(index + 1).padStart(3, "0")}`,
    }));

    expect(goldenDatasetSchema.safeParse({ version: 1, cases }).success).toBe(
      true,
    );
    expect(
      goldenDatasetSchema.safeParse({
        version: 1,
        cases: cases.slice(0, 29),
      }).success,
    ).toBe(false);
    expect(
      goldenDatasetSchema.safeParse({
        version: 1,
        cases: [...cases.slice(0, 29), cases[0]],
      }).success,
    ).toBe(false);
  });

  it("loads and validates the versioned fixture", async () => {
    const dataset = await loadGoldenDataset(
      "tests/fixtures/golden/golden-cases.json",
    );

    expect(dataset.cases).toHaveLength(30);
    expect(new Set(dataset.cases.map((item) => item.id)).size).toBe(30);
  });
});
