import { describe, expect, it } from "vitest";
import {
  ContextEngine,
  MemoryAuditSink,
} from "../../src/engine/context-engine.js";
import { createSeedRepository } from "../../src/catalog/seed.js";
import type { KnowledgeRepository } from "../../src/catalog/repository.js";

const publicPrincipal = {
  id: "dev-1",
  roles: ["developer"],
  groups: [],
  products: ["cgo"],
  domains: ["units"],
  classifications: ["internal"],
};

describe("ContextEngine", () => {
  it("returns insufficient evidence without inventing results", async () => {
    const engine = new ContextEngine(
      createSeedRepository(),
      new MemoryAuditSink(),
    );

    const result = await engine.searchKnowledge(
      { query: "unknown matter", limit: 8 },
      publicPrincipal,
    );

    expect(result.evidenceStatus).toBe("insufficient");
    expect(result.results).toEqual([]);
  });

  it("normalizes an empty repository result to insufficient evidence", async () => {
    const repository: KnowledgeRepository = {
      search: async () => ({
        results: [],
        appliedFilters: {},
        evidenceStatus: "sufficient",
      }),
      getExcerpt: async () => null,
      getLineage: async () => null,
      getProvenance: async () => null,
      listStale: async () => [],
      getArtifact: async () => null,
      getTaxonomy: async () => null,
    };
    const engine = new ContextEngine(repository, new MemoryAuditSink());

    const result = await engine.searchKnowledge(
      { query: "unknown matter", limit: 8 },
      publicPrincipal,
    );

    expect(result).toMatchObject({
      results: [],
      evidenceStatus: "insufficient",
    });
  });

  it("passes stale filters to the repository", async () => {
    let receivedFilters;
    const repository: KnowledgeRepository = {
      search: async () => ({
        results: [],
        appliedFilters: {},
        evidenceStatus: "insufficient",
      }),
      getExcerpt: async () => null,
      getLineage: async () => null,
      getProvenance: async () => null,
      listStale: async (filters) => {
        receivedFilters = filters;
        return [];
      },
      getArtifact: async () => null,
      getTaxonomy: async () => null,
    };
    const engine = new ContextEngine(repository, new MemoryAuditSink());

    await engine.listStaleConcepts({ status: ["superseded"] }, publicPrincipal);

    expect(receivedFilters).toEqual({ status: ["superseded"] });
  });

  it("keeps a context pack within its token budget", async () => {
    const engine = new ContextEngine(
      createSeedRepository(),
      new MemoryAuditSink(),
    );

    const result = await engine.buildContextPack(
      {
        task: "premium unit rules",
        product: "cgo",
        tokenBudget: 500,
        filters: {},
      },
      publicPrincipal,
    );

    expect(result.estimatedTokens).toBeLessThanOrEqual(500);
    expect(
      result.excerpts.every(
        (excerpt) => excerpt.citation.knowledgeId.length > 0,
      ),
    ).toBe(true);
  });

  it("warns about stale superseded knowledge while preserving citations", async () => {
    const engine = new ContextEngine(
      createSeedRepository(),
      new MemoryAuditSink(),
    );

    const result = await engine.searchKnowledge(
      {
        query: "legacy delivery procedure",
        filters: { staleAllowed: true },
        limit: 8,
      },
      publicPrincipal,
    );

    expect(result.results[0]?.citation.knowledgeId).toBe(
      "artifact-superseded-delivery",
    );
    expect(result.warnings).toContain("stale");
    expect(result.warnings).toContain("superseded");
  });

  it("records audit metadata without storing query text", async () => {
    const auditSink = new MemoryAuditSink();
    const engine = new ContextEngine(createSeedRepository(), auditSink);

    await engine.searchKnowledge(
      { query: "premium unit", filters: { product: ["cgo"] }, limit: 8 },
      publicPrincipal,
    );

    expect(auditSink.events).toHaveLength(1);
    expect(auditSink.events[0]).toMatchObject({
      principalId: "dev-1",
      operation: "searchKnowledge",
      filterKeys: ["product"],
      resultCount: 1,
      authorization: "authorized",
      evidenceStatus: "sufficient",
    });
    expect(JSON.stringify(auditSink.events)).not.toContain("premium unit");
  });
});
