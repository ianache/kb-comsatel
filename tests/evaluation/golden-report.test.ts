import { describe, expect, it } from "vitest";

import {
  buildGoldenReport,
  renderGoldenJson,
  renderGoldenMarkdown,
} from "../../src/evaluation/golden-report.js";
import type {
  GoldenCaseResult,
  GoldenEvaluationCase,
} from "../../src/evaluation/golden-types.js";

const cases: Pick<GoldenEvaluationCase, "id" | "tags">[] = [
  { id: "GOLDEN-001", tags: ["evidence", "deterministic"] },
  { id: "GOLDEN-002", tags: ["insufficient", "deterministic"] },
  { id: "GOLDEN-003", tags: ["acl-negative"] },
];

const result = (
  overrides: Partial<GoldenCaseResult> = {},
): GoldenCaseResult => ({
  caseId: "GOLDEN-001",
  status: "passed",
  failureCodes: [],
  latencyMs: 20,
  citationCount: 1,
  evidenceStatus: "sufficient",
  knowledgeIds: ["artifact-public-unit-rule"],
  warnings: [],
  repeatable: true,
  ...overrides,
});

describe("golden evaluation reports", () => {
  it("aggregates counts, coverage, average latency and p95", () => {
    const report = buildGoldenReport(
      [
        result({ caseId: "GOLDEN-001", latencyMs: 10 }),
        result({
          caseId: "GOLDEN-002",
          latencyMs: 20,
          evidenceStatus: "insufficient",
          citationCount: 0,
          knowledgeIds: [],
        }),
        result({
          caseId: "GOLDEN-003",
          latencyMs: 100,
          evidenceStatus: "insufficient",
          citationCount: 0,
          knowledgeIds: [],
        }),
      ],
      { datasetVersion: 1, datasetSize: 30, cases, generatedAt: "2026-09-05T00:00:00.000Z" },
    );

    expect(report).toMatchObject({
      datasetVersion: 1,
      datasetSize: 30,
      executed: 3,
      passed: 3,
      failed: 0,
      complete: true,
      generatedAt: "2026-09-05T00:00:00.000Z",
      metrics: {
        evidenceCitationRate: 1,
        insufficientAccuracy: 1,
        aclNegativeAccuracy: 1,
        determinismRate: 1,
        averageLatencyMs: 43.33,
        p95LatencyMs: 100,
      },
    });
  });

  it("marks incomplete datasets and failed thresholds", () => {
    const report = buildGoldenReport(
      [
        result({
          status: "failed",
          failureCodes: ["MIN_CITATIONS_NOT_MET"],
          citationCount: 0,
        }),
      ],
      {
        datasetVersion: 1,
        datasetSize: 1,
        cases: [{ id: "GOLDEN-001", tags: ["evidence"] }],
      },
    );

    expect(report.complete).toBe(false);
    expect(report.failures).toEqual([
      {
        caseId: "GOLDEN-001",
        tags: ["evidence"],
        failureCodes: ["MIN_CITATIONS_NOT_MET"],
      },
    ]);
  });

  it("renders safe JSON and Markdown without sensitive result fields", () => {
    const report = buildGoldenReport(
      [
        result({
          status: "failed",
          failureCodes: ["SAFE_ERROR"],
          knowledgeIds: ["artifact-public-unit-rule"],
        }),
      ],
      { datasetVersion: 1, datasetSize: 30, cases: [{ id: "GOLDEN-001", tags: ["evidence"] }] },
    );
    const json = renderGoldenJson(report);
    const markdown = renderGoldenMarkdown(report);

    expect(json).toContain("GOLDEN-001");
    expect(markdown).toContain("evidenceCitationRate");
    for (const rendered of [json, markdown]) {
      expect(rendered).not.toMatch(/premium unit|full excerpt|Authorization|Bearer|secret|token/i);
    }
  });
});
