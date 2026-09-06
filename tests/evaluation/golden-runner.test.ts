import { describe, expect, it } from "vitest";

import { createSeedRepository } from "../../src/catalog/seed.js";
import { ContextEngine } from "../../src/engine/context-engine.js";
import { MemoryAuditSink } from "../../src/engine/audit.js";
import { GoldenEvaluationRunner } from "../../src/evaluation/golden-runner.js";
import type { GoldenEvaluationCase } from "../../src/evaluation/golden-types.js";

const developer = {
  id: "golden-developer",
  roles: ["developer"],
  groups: [],
  products: ["cgo"],
  domains: ["units"],
  classifications: ["internal"],
};

const architect = {
  ...developer,
  id: "golden-architect",
  roles: ["architect"],
  groups: ["architecture-reviewers"],
};

function createRunner(): GoldenEvaluationRunner {
  return new GoldenEvaluationRunner(
    new ContextEngine(createSeedRepository(), new MemoryAuditSink()),
  );
}

function makeCase(
  overrides: Partial<GoldenEvaluationCase>,
): GoldenEvaluationCase {
  return {
    id: "GOLDEN-TEST",
    tool: "search_knowledge",
    input: { query: "premium unit", limit: 8 },
    principal: developer,
    expectations: { evidenceStatus: "sufficient", minCitations: 1 },
    tags: ["evidence", "deterministic"],
    ...overrides,
  };
}

describe("GoldenEvaluationRunner", () => {
  it("validates a cited search result", async () => {
    const [result] = await createRunner().run([
      makeCase({
        expectations: {
          evidenceStatus: "sufficient",
          minCitations: 1,
          requiredKnowledgeIds: ["artifact-public-unit-rule"],
        },
      }),
    ]);

    expect(result).toMatchObject({
      status: "passed",
      evidenceStatus: "sufficient",
      citationCount: 1,
      knowledgeIds: ["artifact-public-unit-rule"],
      repeatable: true,
    });
    expect(result?.failureCodes).toEqual([]);
  });

  it("supports context packs and task context", async () => {
    const results = await createRunner().run([
      makeCase({
        id: "GOLDEN-CONTEXT",
        tool: "build_context_pack",
        input: {
          task: "premium unit delivery",
          product: "cgo",
          tokenBudget: 1200,
          filters: {},
        },
      }),
      makeCase({
        id: "GOLDEN-TASK",
        tool: "get_task_context",
        input: {
          task: "Issue #123 premium unit",
          product: "cgo",
          tokenBudget: 1200,
          filters: {},
        },
      }),
    ]);

    expect(results.every((result) => result.status === "passed")).toBe(true);
  });

  it("detects insufficient evidence and ACL isolation", async () => {
    const results = await createRunner().run([
      makeCase({
        id: "GOLDEN-NO-EVIDENCE",
        input: { query: "unknown topic", limit: 8 },
        expectations: { evidenceStatus: "insufficient", minCitations: 0 },
        tags: ["insufficient"],
      }),
      makeCase({
        id: "GOLDEN-ACL",
        input: { query: "architecture decision", limit: 8 },
        expectations: {
          evidenceStatus: "insufficient",
          forbiddenKnowledgeIds: ["artifact-restricted-adr"],
        },
        tags: ["insufficient", "acl-negative"],
      }),
    ]);

    expect(results.map((result) => result.status)).toEqual([
      "passed",
      "passed",
    ]);
    expect(results[1]?.knowledgeIds).toEqual([]);
  });

  it("preserves warnings and reports expectation failures safely", async () => {
    const [warning, failed] = await createRunner().run([
      makeCase({
        id: "GOLDEN-STALE",
        input: {
          query: "delivery",
          filters: { status: ["superseded"], staleAllowed: true },
          limit: 8,
        },
        expectations: {
          evidenceStatus: "sufficient",
          minCitations: 1,
          expectedWarning: "superseded",
        },
        tags: ["evidence", "stale"],
      }),
      makeCase({
        id: "GOLDEN-FAIL",
        expectations: {
          evidenceStatus: "sufficient",
          minCitations: 2,
        },
        tags: ["evidence"],
      }),
    ]);

    expect(warning).toMatchObject({ status: "passed" });
    expect(failed?.status).toBe("failed");
    expect(failed?.failureCodes).toContain("MIN_CITATIONS_NOT_MET");
  });

  it("uses the authorized principal supplied by each case", async () => {
    const [result] = await createRunner().run([
      makeCase({
        id: "GOLDEN-ARCHITECT",
        principal: architect,
        input: { query: "architecture decision", limit: 8 },
        expectations: {
          evidenceStatus: "sufficient",
          minCitations: 1,
          requiredKnowledgeIds: ["artifact-restricted-adr"],
        },
        tags: ["evidence"],
      }),
    ]);

    expect(result).toMatchObject({
      status: "passed",
      knowledgeIds: ["artifact-restricted-adr"],
    });
  });
});
