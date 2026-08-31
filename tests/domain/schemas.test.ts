import { expect, it } from "vitest";
import {
  buildContextPackInputSchema,
  citationSchema,
  searchKnowledgeInputSchema,
} from "../../src/domain/schemas.js";

it("rejects a search limit outside 1..20", () => {
  expect(
    searchKnowledgeInputSchema.safeParse({ query: "rules", limit: 21 }).success,
  ).toBe(false);
});

it("rejects a context budget outside 500..12000", () => {
  expect(
    buildContextPackInputSchema.safeParse({
      task: "task",
      product: "cgo",
      tokenBudget: 499,
      filters: {},
    }).success,
  ).toBe(false);
});

it("accepts a citation without a locator", () => {
  expect(
    citationSchema.safeParse({
      knowledgeId: "artifact-1",
      title: "Architecture rule",
      sourceUri: "https://example.com/artifacts/1",
      sourceRevision: "rev-1",
      sourceSystem: "gitlab",
      scope: { product: "cgo", domain: "units" },
      status: "stable",
    }).success,
  ).toBe(true);
});

it("requires filters for a context pack", () => {
  expect(
    buildContextPackInputSchema.safeParse({
      task: "task",
      product: "cgo",
      tokenBudget: 500,
    }).success,
  ).toBe(false);
});
