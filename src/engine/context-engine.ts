import { randomUUID } from "node:crypto";

import type { KnowledgeRepository } from "../catalog/repository.js";
import {
  buildContextPackInputSchema,
  contextPackSchema,
  type AccessPrincipal,
  type ArtifactLineage,
  type KnowledgeArtifact,
  type ContextPack,
  type KnowledgeExcerpt,
  type KnowledgeFilters,
  type Provenance,
  type SearchKnowledgeInput,
  type SearchKnowledgeResult,
  type StaleConcept,
  type Taxonomy,
} from "../domain/schemas.js";
import type { AuditEvent, AuditSink } from "./audit.js";

export { MemoryAuditSink } from "./audit.js";
export type { AuditEvent, AuditSink } from "./audit.js";

type KnowledgeWarning = "draft" | "deprecated" | "superseded" | "stale";

export interface ContextSearchResult extends SearchKnowledgeResult {
  warnings: KnowledgeWarning[];
}

export class ContextEngine {
  constructor(
    private readonly repository: KnowledgeRepository,
    private readonly auditSink: AuditSink,
  ) {}

  async searchKnowledge(
    input: SearchKnowledgeInput,
    principal: AccessPrincipal,
  ): Promise<ContextSearchResult> {
    const startedAt = performance.now();
    try {
      const result = await this.repository.search(input, principal);
      const stale = await this.repository.listStale({}, principal);
      const staleIds = new Set(stale.map((concept) => concept.knowledgeId));
      const warnings = [
        ...new Set(
          result.results.flatMap((item) => {
            const itemWarnings: KnowledgeWarning[] = [];
            if (item.citation.status === "draft") itemWarnings.push("draft");
            if (item.citation.status === "deprecated")
              itemWarnings.push("deprecated");
            if (item.citation.status === "superseded")
              itemWarnings.push("superseded");
            if (item.trust === "stale" || staleIds.has(item.knowledgeId)) {
              itemWarnings.push("stale");
            }
            return itemWarnings;
          }),
        ),
      ];
      const enriched: ContextSearchResult = {
        ...result,
        results: result.results.length === 0 ? [] : result.results,
        evidenceStatus:
          result.results.length === 0 ? "insufficient" : result.evidenceStatus,
        warnings,
      };
      await this.record(
        principal,
        "searchKnowledge",
        Object.keys(input.filters ?? {}),
        enriched.results.length,
        enriched.evidenceStatus,
        startedAt,
      );
      return enriched;
    } catch (error) {
      await this.record(
        principal,
        "searchKnowledge",
        Object.keys(input.filters ?? {}),
        0,
        "insufficient",
        startedAt,
        "denied",
      );
      throw error;
    }
  }

  async getKnowledgeExcerpt(
    knowledgeId: string,
    principal: AccessPrincipal,
  ): Promise<KnowledgeExcerpt | null> {
    return this.readOne("getKnowledgeExcerpt", knowledgeId, principal, (id) =>
      this.repository.getExcerpt(id, principal),
    );
  }

  async getArtifactLineage(
    knowledgeId: string,
    principal: AccessPrincipal,
  ): Promise<ArtifactLineage | null> {
    return this.readOne("getArtifactLineage", knowledgeId, principal, (id) =>
      this.repository.getLineage(id, principal),
    );
  }

  async getProvenance(
    knowledgeId: string,
    principal: AccessPrincipal,
  ): Promise<Provenance | null> {
    return this.readOne("getProvenance", knowledgeId, principal, (id) =>
      this.repository.getProvenance(id, principal),
    );
  }

  async listStaleConcepts(
    filters: KnowledgeFilters,
    principal: AccessPrincipal,
  ): Promise<StaleConcept[]> {
    const startedAt = performance.now();
    try {
      const result = await this.repository.listStale(filters, principal);
      await this.record(
        principal,
        "listStaleConcepts",
        Object.keys(filters),
        result.length,
        result.length === 0 ? "insufficient" : "sufficient",
        startedAt,
      );
      return result;
    } catch (error) {
      await this.record(
        principal,
        "listStaleConcepts",
        Object.keys(filters),
        0,
        "insufficient",
        startedAt,
        "denied",
      );
      throw error;
    }
  }

  async getArtifact(
    knowledgeId: string,
    revision: string | undefined,
    principal: AccessPrincipal,
  ): Promise<KnowledgeArtifact | null> {
    return this.readOne("getArtifact", knowledgeId, principal, (id) =>
      this.repository.getArtifact(id, revision, principal),
    );
  }

  async getTaxonomy(
    domain: string,
    principal: AccessPrincipal,
  ): Promise<Taxonomy | null> {
    return this.readOne("getTaxonomy", domain, principal, (value) =>
      this.repository.getTaxonomy(value, principal),
    );
  }

  async buildContextPack(
    input: {
      task: string;
      product: string;
      tokenBudget: number;
      filters: KnowledgeFilters;
    },
    principal: AccessPrincipal,
  ): Promise<ContextPack> {
    const parsedInput = buildContextPackInputSchema.parse(input);
    return this.buildContextPackForTask(
      parsedInput,
      principal,
      parsedInput.task,
    );
  }

  async getTaskContext(
    input: {
      task: string;
      product: string;
      tokenBudget: number;
      filters: KnowledgeFilters;
    },
    principal: AccessPrincipal,
  ): Promise<ContextPack> {
    const parsedInput = buildContextPackInputSchema.parse(input);
    const rankingTask = this.extractIssueAndMergeRequestIds(parsedInput.task);
    return this.buildContextPackForTask(parsedInput, principal, rankingTask);
  }

  private async buildContextPackForTask(
    input: {
      task: string;
      product: string;
      tokenBudget: number;
      filters: KnowledgeFilters;
    },
    principal: AccessPrincipal,
    rankingTask: string,
  ): Promise<ContextPack> {
    const startedAt = performance.now();
    try {
      const filters = {
        ...input.filters,
        product: input.filters.product ?? [input.product],
      };
      const search = await this.repository.search(
        { query: rankingTask, filters, limit: 20 },
        principal,
      );
      const base: ContextPack = {
        restrictions: [],
        facts: [],
        decisions: [],
        relatedArtifacts: [],
        conflicts: [],
        missingKnowledge:
          search.results.length === 0 ? ["No accessible knowledge found."] : [],
        excerpts: [],
        citations: [],
        estimatedTokens: 0,
        evidenceStatus:
          search.results.length === 0 ? "insufficient" : "sufficient",
      };
      let pack = this.withEstimatedTokens(base);

      for (const result of search.results) {
        const excerpt: KnowledgeExcerpt = {
          knowledgeId: result.knowledgeId,
          excerpt: result.excerpt,
          citation: result.citation,
        };
        const candidate = this.withEstimatedTokens({
          ...pack,
          facts: [
            ...pack.facts,
            { text: result.excerpt, citation: result.citation },
          ],
          relatedArtifacts: [...pack.relatedArtifacts, result.citation],
          excerpts: [...pack.excerpts, excerpt],
          citations: [...pack.citations, result.citation],
        });
        if (candidate.estimatedTokens > input.tokenBudget) {
          if (pack.excerpts.length === 0) {
            pack = this.withEstimatedTokens({
              ...base,
              missingKnowledge: [
                "Evidence exceeds the configured token budget.",
              ],
              evidenceStatus: "insufficient",
            });
          }
          break;
        }
        pack = candidate;
      }

      const parsedPack = contextPackSchema.parse(pack);
      await this.record(
        principal,
        "buildContextPack",
        Object.keys(filters),
        parsedPack.excerpts.length,
        parsedPack.evidenceStatus,
        startedAt,
      );
      return parsedPack;
    } catch (error) {
      await this.record(
        principal,
        "buildContextPack",
        Object.keys(input.filters),
        0,
        "insufficient",
        startedAt,
        "denied",
      );
      throw error;
    }
  }

  private async readOne<T>(
    operation: string,
    knowledgeId: string,
    principal: AccessPrincipal,
    read: (knowledgeId: string) => Promise<T | null>,
  ): Promise<T | null> {
    const startedAt = performance.now();
    try {
      const result = await read(knowledgeId);
      await this.record(
        principal,
        operation,
        [],
        result === null ? 0 : 1,
        result === null ? "insufficient" : "sufficient",
        startedAt,
      );
      return result;
    } catch (error) {
      await this.record(
        principal,
        operation,
        [],
        0,
        "insufficient",
        startedAt,
        "denied",
      );
      throw error;
    }
  }

  private withEstimatedTokens(pack: ContextPack): ContextPack {
    const content = JSON.stringify({ ...pack, estimatedTokens: 0 });
    return { ...pack, estimatedTokens: Math.ceil(content.length / 4) };
  }

  private extractIssueAndMergeRequestIds(task: string): string {
    const identifiers =
      task.match(/(?:!|#)\d+|\b(?:issue|mr)\s*\d+\b/giu) ?? [];
    return identifiers.length === 0 ? task : `${task} ${identifiers.join(" ")}`;
  }

  private async record(
    principal: AccessPrincipal,
    operation: string,
    filterKeys: string[],
    resultCount: number,
    evidenceStatus: AuditEvent["evidenceStatus"],
    startedAt: number,
    authorization: AuditEvent["authorization"] = "authorized",
  ): Promise<void> {
    await this.auditSink.record({
      correlationId: randomUUID(),
      principalId: principal.id,
      operation,
      filterKeys: [...filterKeys].sort(),
      resultCount,
      authorization,
      evidenceStatus,
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
    });
  }
}
