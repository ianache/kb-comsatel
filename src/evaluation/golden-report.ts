import type {
  GoldenCaseResult,
  GoldenEvaluationCase,
  GoldenEvaluationReport,
  GoldenTag,
} from "./golden-types.js";

const thresholds = {
  minimumDatasetSize: 30,
  evidenceCitationRate: 0.9,
  insufficientAccuracy: 1,
  aclNegativeAccuracy: 1,
  determinismRate: 1,
};

interface GoldenReportOptions {
  datasetVersion: number;
  datasetSize: number;
  cases: readonly Pick<GoldenEvaluationCase, "id" | "tags">[];
  generatedAt?: string;
}

export function buildGoldenReport(
  results: readonly GoldenCaseResult[],
  options: GoldenReportOptions,
): GoldenEvaluationReport {
  const byId = new Map(options.cases.map((item) => [item.id, item]));
  const tagged = (tag: GoldenTag) =>
    results.filter((result) => byId.get(result.caseId)?.tags.includes(tag));
  const passed = results.filter((result) => result.status === "passed").length;
  const latencies = results.map((result) => result.latencyMs);
  const metrics = {
    evidenceCitationRate: rate(
      tagged("evidence"),
      (result) => result.status === "passed" && result.citationCount > 0,
    ),
    insufficientAccuracy: rate(
      tagged("insufficient"),
      (result) => result.status === "passed" && result.evidenceStatus === "insufficient",
    ),
    aclNegativeAccuracy: rate(
      tagged("acl-negative"),
      (result) => result.status === "passed" && result.knowledgeIds.length === 0,
    ),
    determinismRate: rate(
      tagged("deterministic"),
      (result) => result.status === "passed" && result.repeatable,
    ),
    averageLatencyMs: round(average(latencies)),
    p95LatencyMs: round(percentile95(latencies)),
  };
  const complete =
    options.datasetSize >= thresholds.minimumDatasetSize &&
    metrics.evidenceCitationRate >= thresholds.evidenceCitationRate &&
    metrics.insufficientAccuracy >= thresholds.insufficientAccuracy &&
    metrics.aclNegativeAccuracy >= thresholds.aclNegativeAccuracy &&
    metrics.determinismRate >= thresholds.determinismRate;

  return {
    datasetVersion: options.datasetVersion,
    datasetSize: options.datasetSize,
    executed: results.length,
    passed,
    failed: results.length - passed,
    complete,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    thresholds,
    metrics,
    failures: results
      .filter((result) => result.status === "failed")
      .map((result) => ({
        caseId: result.caseId,
        tags: byId.get(result.caseId)?.tags ?? [],
        failureCodes: [...result.failureCodes],
      })),
  };
}

export function renderGoldenJson(report: GoldenEvaluationReport): string {
  return JSON.stringify(report, null, 2);
}

export function renderGoldenMarkdown(report: GoldenEvaluationReport): string {
  const failureLines =
    report.failures.length === 0
      ? "- None"
      : report.failures
          .map(
            (failure) =>
              `- ${failure.caseId}: ${failure.failureCodes.join(", ")}`,
          )
          .join("\n");
  return [
    "# I5-D Golden Evaluation Report",
    "",
    `- Dataset version: ${report.datasetVersion}`,
    `- Dataset size: ${report.datasetSize}`,
    `- Executed: ${report.executed}`,
    `- Passed: ${report.passed}`,
    `- Failed: ${report.failed}`,
    `- Complete: ${report.complete}`,
    `- Generated at: ${report.generatedAt}`,
    "",
    "## Metrics",
    "",
    "| Metric | Value |",
    "|---|---:|",
    `| evidenceCitationRate | ${report.metrics.evidenceCitationRate} |`,
    `| insufficientAccuracy | ${report.metrics.insufficientAccuracy} |`,
    `| aclNegativeAccuracy | ${report.metrics.aclNegativeAccuracy} |`,
    `| determinismRate | ${report.metrics.determinismRate} |`,
    `| averageLatencyMs | ${report.metrics.averageLatencyMs} |`,
    `| p95LatencyMs | ${report.metrics.p95LatencyMs} |`,
    "",
    "## Failures",
    "",
    failureLines,
    "",
  ].join("\n");
}

function rate(
  values: readonly GoldenCaseResult[],
  predicate: (result: GoldenCaseResult) => boolean,
): number {
  return values.length === 0
    ? 1
    : round(values.filter(predicate).length / values.length);
}

function average(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((total, value) => total + value, 0) / values.length;
}

function percentile95(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
