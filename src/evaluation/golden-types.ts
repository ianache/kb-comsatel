import { z } from "zod";

import {
  accessPrincipalSchema,
  knowledgeFiltersSchema,
  type AccessPrincipal,
} from "../domain/schemas.js";

export const goldenToolSchema = z.enum([
  "search_knowledge",
  "build_context_pack",
  "get_task_context",
]);

export const goldenTagSchema = z.enum([
  "evidence",
  "insufficient",
  "acl-negative",
  "stale",
  "deterministic",
]);

const goldenExpectationsSchema = z
  .object({
    evidenceStatus: z.enum(["sufficient", "insufficient"]),
    minCitations: z.number().int().min(0).optional(),
    requiredKnowledgeIds: z.array(z.string().trim().min(1)).optional(),
    forbiddenKnowledgeIds: z.array(z.string().trim().min(1)).optional(),
    expectedWarning: z
      .enum(["draft", "deprecated", "superseded", "stale"])
      .optional(),
  })
  .strict();

export const goldenCaseSchema = z
  .object({
    id: z.string().trim().min(1),
    tool: goldenToolSchema,
    input: z.record(z.string(), z.unknown()),
    principal: accessPrincipalSchema,
    expectations: goldenExpectationsSchema,
    tags: z.array(goldenTagSchema).min(1),
  })
  .strict();

export type GoldenTool = z.infer<typeof goldenToolSchema>;
export type GoldenTag = z.infer<typeof goldenTagSchema>;
export type GoldenEvaluationCase = z.infer<typeof goldenCaseSchema>;
export type GoldenExpectations = z.infer<typeof goldenExpectationsSchema>;

export interface GoldenCaseResult {
  caseId: string;
  status: "passed" | "failed";
  failureCodes: string[];
  latencyMs: number;
  citationCount: number;
  evidenceStatus: "sufficient" | "insufficient";
  knowledgeIds: string[];
  warnings: string[];
  repeatable: boolean;
}

export interface GoldenEvaluationDataset {
  version: number;
  cases: GoldenEvaluationCase[];
}

export interface GoldenEvaluationReport {
  datasetVersion: number;
  datasetSize: number;
  executed: number;
  passed: number;
  failed: number;
  complete: boolean;
  generatedAt: string;
  thresholds: {
    minimumDatasetSize: number;
    evidenceCitationRate: number;
    insufficientAccuracy: number;
    aclNegativeAccuracy: number;
    determinismRate: number;
  };
  metrics: {
    evidenceCitationRate: number;
    insufficientAccuracy: number;
    aclNegativeAccuracy: number;
    determinismRate: number;
    averageLatencyMs: number;
    p95LatencyMs: number;
  };
  failures: Array<{
    caseId: string;
    tags: GoldenTag[];
    failureCodes: string[];
  }>;
}

export type GoldenPrincipal = AccessPrincipal;
export type GoldenFilters = z.infer<typeof knowledgeFiltersSchema>;
