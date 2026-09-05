import { describe, expect, it } from "vitest";
import { buildPublicationPlan } from "../../src/publication/publication-plan.js";
import type { PublicationRequest } from "../../src/publication/publication-types.js";
import type { CompiledCorpus } from "../../src/okf/compiler.js";

const corpus = {
  manifest: {
    contractVersion: "okf-v0.2-i4a",
    corpusHash: "hash-1",
    documents: [
      {
        knowledgeId: "rule-1",
        title: "Rule",
        artifactType: "rule",
        sourceSystem: "okf",
        sourceUri: "https://example.test/rule-1",
        sourceRevision: "rev-1",
        product: "cgo",
        domain: "units",
        classification: "internal",
        status: "stable",
        path: "documents/rule-1.md",
        locator: {},
        acl: {
          principalIds: [],
          roles: [],
          groups: [],
          products: [],
          domains: [],
          classifications: ["internal"],
        },
      },
    ],
    counts: { discovered: 1, valid: 1, indexable: 1, errors: 0 },
    errors: [],
    warnings: [],
  },
  documents: [],
  okfDocuments: [
    {
      file: "rule.md",
      knowledgeId: "rule-1",
      title: "Rule",
      artifactType: "rule",
      sourceUri: "https://example.test/rule-1",
      sourceRevision: "rev-1",
      product: "cgo",
      domain: "units",
      classification: "internal",
      status: "stable",
      owner: "architecture",
      evidence: ["https://example.test/evidence/rule-1"],
      verifiedAt: "2026-09-01T00:00:00.000Z",
      locator: {},
      acl: {
        principalIds: [],
        roles: [],
        groups: [],
        products: [],
        domains: [],
        classifications: ["internal"],
      },
      relations: { relatedTo: [] },
      content: "# Rule\n",
    },
  ],
  errors: [],
  warnings: [],
} as unknown as CompiledCorpus;

const validRequest: PublicationRequest = {
  projectId: "project-1",
  baseBranch: "main",
  baseSha: "base-sha-1",
  branchPrefix: "knowledge/proposal",
  corpus,
  title: "Publish OKF rule",
  description: "Propose a curated rule",
  labels: ["knowledge", "okf"],
  reviewerIds: ["reviewer-1"],
  mode: "proposal",
  correlationId: "corr-1",
};

describe("buildPublicationPlan", () => {
  it("builds a deterministic publication identity", () => {
    const plan = buildPublicationPlan(validRequest);

    expect(plan.identityKey).toBe("project-1|main|hash-1|proposal");
    expect(plan.branchName).toBe("knowledge/proposal/hash-1");
    expect(plan.commitMessage).toBe("knowledge: propose corpus hash-1");
    expect(plan.files.map((file) => file.path)).toEqual([
      "knowledge/rule-1.md",
    ]);
    expect(plan.mergeRequestTitle).toBe("Publish OKF rule");
  });

  it("produces the same plan regardless of document order", () => {
    const reversed = {
      ...validRequest,
      corpus: { ...corpus, okfDocuments: [...corpus.okfDocuments].reverse() },
    };

    expect(buildPublicationPlan(reversed)).toEqual(
      buildPublicationPlan(validRequest),
    );
  });
});
