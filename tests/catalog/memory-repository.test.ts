import { describe, expect, it } from "vitest";
import { createSeedRepository } from "../../src/catalog/seed.js";

const publicPrincipal = {
  id: "dev-1",
  roles: ["developer"],
  groups: [],
  products: ["cgo"],
  domains: ["units"],
  classifications: ["internal"],
};

const restrictedPrincipal = {
  ...publicPrincipal,
  groups: ["architecture-reviewers"],
};

describe("MemoryKnowledgeRepository", () => {
  it("returns stable public evidence", async () => {
    const result = await createSeedRepository().search(
      { query: "premium unit", limit: 8 },
      publicPrincipal,
    );

    expect(result.results[0]?.citation.status).toBe("stable");
    expect(result.results[0]?.citation.sourceUri).toMatch(/^https:\/\//);
    expect(result.results[0]?.citation).toMatchObject({
      sourceSystem: "gitlab",
      scope: { product: "cgo", domain: "units" },
      locator: { sectionPath: "rules.premium-unit" },
    });
  });

  it("does not reveal restricted artifacts without the group", async () => {
    const result = await createSeedRepository().search(
      { query: "architecture decision", limit: 8 },
      publicPrincipal,
    );

    expect(result.results).toHaveLength(0);
    expect(
      await createSeedRepository().getArtifact(
        "artifact-restricted-adr",
        undefined,
        publicPrincipal,
      ),
    ).toBeNull();
    expect(
      await createSeedRepository().getArtifact(
        "artifact-restricted-adr",
        undefined,
        restrictedPrincipal,
      ),
    ).not.toBeNull();
  });

  it("applies filters before deterministic term-overlap ranking", async () => {
    const result = await createSeedRepository().search(
      {
        query: "premium unit",
        filters: { artifactType: ["rule"], verifiedOnly: true },
        limit: 8,
      },
      publicPrincipal,
    );

    expect(result.results.map((item) => item.knowledgeId)).toEqual([
      "artifact-public-unit-rule",
    ]);
  });

  it("returns only stale artifacts and exposes their provenance", async () => {
    const repository = createSeedRepository();
    const stale = await repository.listStale({}, publicPrincipal);
    const staleArtifact = stale[0];

    expect(staleArtifact?.knowledgeId).toBe("artifact-superseded-delivery");
    expect(staleArtifact?.citation.locator?.sectionPath).toBeDefined();
    expect(
      await repository.getLineage(
        "artifact-superseded-delivery",
        publicPrincipal,
      ),
    ).toMatchObject({ successorKnowledgeId: "artifact-public-unit-rule" });
    expect(
      await repository.getProvenance(
        "artifact-superseded-delivery",
        publicPrincipal,
      ),
    ).toMatchObject({
      canonicalUri: expect.stringMatching(/^https:\/\//),
      sourceSystem: "okf",
      scope: { product: "cgo", domain: "units" },
      locator: { sectionPath: "delivery.legacy" },
    });
  });

  it("returns the cgo taxonomy to authorized principals", async () => {
    await expect(
      createSeedRepository().getTaxonomy("units", publicPrincipal),
    ).resolves.toMatchObject({ product: "cgo", domain: "units" });
  });

  it("filters stale concepts through the repository boundary", async () => {
    await expect(
      createSeedRepository().listStale(
        { status: ["superseded"] },
        publicPrincipal,
      ),
    ).resolves.toHaveLength(1);
    await expect(
      createSeedRepository().listStale({ status: ["draft"] }, publicPrincipal),
    ).resolves.toEqual([]);
  });
});
