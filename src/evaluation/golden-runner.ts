import type {
  ContextPack,
  SearchKnowledgeInput,
  SearchKnowledgeResult,
  AccessPrincipal,
} from "../domain/schemas.js";
import { ContextEngine, type ContextSearchResult } from "../engine/context-engine.js";
import type {
  GoldenCaseResult,
  GoldenEvaluationCase,
  GoldenEvaluationDataset,
} from "./golden-types.js";

interface PublicGoldenOutput {
  evidenceStatus: "sufficient" | "insufficient";
  citationCount: number;
  knowledgeIds: string[];
  warnings: string[];
}

export class GoldenEvaluationRunner {
  constructor(private readonly engine: ContextEngine) {}

  async run(
    dataset: GoldenEvaluationDataset | readonly GoldenEvaluationCase[],
  ): Promise<GoldenCaseResult[]> {
    const cases = Array.isArray(dataset) ? dataset : dataset.cases;
    const results: GoldenCaseResult[] = [];
    for (const evaluationCase of cases) {
      results.push(await this.runCase(evaluationCase));
    }
    return results;
  }

  private async runCase(
    evaluationCase: GoldenEvaluationCase,
  ): Promise<GoldenCaseResult> {
    const startedAt = performance.now();
    const first = await this.executeSafely(evaluationCase);
    const failures = first.failures;
    let repeatable = true;

    if (evaluationCase.tags.includes("deterministic") && first.output !== null) {
      const second = await this.executeSafely(evaluationCase);
      repeatable =
        second.output !== null &&
        JSON.stringify(second.output) === JSON.stringify(first.output);
      if (!repeatable) failures.push("NON_DETERMINISTIC_RESULT");
    }

    const output = first.output ?? {
      evidenceStatus: "insufficient" as const,
      citationCount: 0,
      knowledgeIds: [],
      warnings: [],
    };

    return {
      caseId: evaluationCase.id,
      status: failures.length === 0 ? "passed" : "failed",
      failureCodes: [...new Set(failures)],
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      citationCount: output.citationCount,
      evidenceStatus: output.evidenceStatus,
      knowledgeIds: output.knowledgeIds,
      warnings: output.warnings,
      repeatable,
    };
  }

  private async executeSafely(
    evaluationCase: GoldenEvaluationCase,
  ): Promise<{ output: PublicGoldenOutput | null; failures: string[] }> {
    try {
      const output = await this.execute(evaluationCase);
      return { output, failures: this.validate(evaluationCase, output) };
    } catch {
      return { output: null, failures: ["UNEXPECTED_ERROR"] };
    }
  }

  private async execute(
    evaluationCase: GoldenEvaluationCase,
  ): Promise<PublicGoldenOutput> {
    const input = evaluationCase.input;
    switch (evaluationCase.tool) {
      case "search_knowledge":
        return this.fromSearch(
          await this.engine.searchKnowledge(
            input as unknown as SearchKnowledgeInput,
            evaluationCase.principal as AccessPrincipal,
          ),
        );
      case "build_context_pack":
        return this.fromContextPack(
          await this.engine.buildContextPack(
            input as Parameters<ContextEngine["buildContextPack"]>[0],
            evaluationCase.principal,
          ),
        );
      case "get_task_context":
        return this.fromContextPack(
          await this.engine.getTaskContext(
            input as Parameters<ContextEngine["getTaskContext"]>[0],
            evaluationCase.principal,
          ),
        );
    }
  }

  private fromSearch(result: SearchKnowledgeResult | ContextSearchResult) {
    return {
      evidenceStatus: result.evidenceStatus,
      citationCount: result.results.length,
      knowledgeIds: result.results.map((item) => item.knowledgeId),
      warnings: "warnings" in result ? [...result.warnings] : [],
    } satisfies PublicGoldenOutput;
  }

  private fromContextPack(result: ContextPack): PublicGoldenOutput {
    const warnings = new Set<string>();
    for (const citation of result.citations) {
      if (citation.status === "superseded") warnings.add("superseded");
      if (citation.status === "deprecated") warnings.add("deprecated");
      if (citation.status === "draft") warnings.add("draft");
      if (citation.status === "superseded" || citation.status === "stale") {
        warnings.add("stale");
      }
    }
    return {
      evidenceStatus: result.evidenceStatus,
      citationCount: result.citations.length,
      knowledgeIds: result.citations.map((citation) => citation.knowledgeId),
      warnings: [...warnings].sort(),
    };
  }

  private validate(
    evaluationCase: GoldenEvaluationCase,
    output: PublicGoldenOutput,
  ): string[] {
    const failures: string[] = [];
    const expectations = evaluationCase.expectations;
    if (output.evidenceStatus !== expectations.evidenceStatus) {
      failures.push("EVIDENCE_STATUS_MISMATCH");
    }
    if (
      expectations.minCitations !== undefined &&
      output.citationCount < expectations.minCitations
    ) {
      failures.push("MIN_CITATIONS_NOT_MET");
    }
    for (const knowledgeId of expectations.requiredKnowledgeIds ?? []) {
      if (!output.knowledgeIds.includes(knowledgeId)) {
        failures.push("REQUIRED_KNOWLEDGE_MISSING");
      }
    }
    for (const knowledgeId of expectations.forbiddenKnowledgeIds ?? []) {
      if (output.knowledgeIds.includes(knowledgeId)) {
        failures.push("FORBIDDEN_KNOWLEDGE_RETURNED");
      }
    }
    if (
      expectations.expectedWarning !== undefined &&
      !output.warnings.includes(expectations.expectedWarning)
    ) {
      failures.push("EXPECTED_WARNING_MISSING");
    }
    return failures;
  }
}
