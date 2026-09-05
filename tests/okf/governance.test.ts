import { describe, expect, it } from "vitest";
import { validateGovernance } from "../../src/okf/governance.js";
import { okfDocumentSchema } from "../../src/okf/okf-schema.js";
import { toSourceDocument } from "../../src/okf/okf-types.js";

const valid = okfDocumentSchema.parse({
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
  acl: { classifications: ["internal"] },
  relations: {},
  content: "# Rule\n",
});

describe("OKF governance", () => {
  it("requires a successor for superseded documents", () => {
    const issues = validateGovernance(
      { ...valid, status: "superseded", relations: {} },
      new Set([valid.knowledgeId]),
    );

    expect(issues.map((issue) => issue.code)).toContain(
      "SUPERSEDED_SUCCESSOR_REQUIRED",
    );
  });

  it("rejects a stable document without evidence and owner", () => {
    const issues = validateGovernance(
      { ...valid, owner: "", evidence: [] },
      new Set([valid.knowledgeId]),
    );

    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "STABLE_OWNER_REQUIRED",
        "STABLE_EVIDENCE_REQUIRED",
      ]),
    );
  });

  it("rejects a relation to an unknown document", () => {
    const issues = validateGovernance(
      { ...valid, relations: { supersededBy: "missing" } },
      new Set([valid.knowledgeId]),
    );

    expect(issues.map((issue) => issue.code)).toContain(
      "RELATION_TARGET_NOT_FOUND",
    );
  });

  it("maps a valid OKF document to the I3 source contract", () => {
    expect(toSourceDocument(valid)).toMatchObject({
      knowledgeId: "rule-1",
      sourceSystem: "okf",
      artifactType: "rule",
      content: "# Rule\n",
    });
  });
});
