import type {
  ArtifactLineage,
  KnowledgeArtifact,
  Provenance,
  Taxonomy,
} from "../domain/schemas.js";
import { MemoryKnowledgeRepository } from "./memory-repository.js";

const artifacts: KnowledgeArtifact[] = [
  {
    knowledgeId: "artifact-public-unit-rule",
    title: "Premium unit eligibility rule",
    excerpt:
      "Premium unit requests require a verified unit identifier before delivery.",
    artifactType: "rule",
    product: "cgo",
    domain: "units",
    status: "stable",
    sourceSystem: "gitlab",
    sourceUri: "https://gitlab.example.com/cgo/units/rules/premium-unit",
    sourceRevision: "a1b2c3d4",
    contentHash: "sha256-public-unit-rule",
    locator: { sectionPath: "rules.premium-unit", lineRange: "12-18" },
    verifiedAt: "2026-08-01T00:00:00.000Z",
    acl: { groups: [], classifications: ["internal"] },
  },
  {
    knowledgeId: "artifact-restricted-adr",
    title: "Architecture decision for unit ownership",
    excerpt:
      "Architecture decision records the ownership boundary for premium unit changes.",
    artifactType: "architecture-decision",
    product: "cgo",
    domain: "units",
    status: "stable",
    sourceSystem: "google-drive",
    sourceUri: "https://drive.example.com/cgo/adr/unit-ownership",
    sourceRevision: "revision-42",
    contentHash: "sha256-restricted-adr",
    locator: { pageRange: "3-4", sectionPath: "decision" },
    verifiedAt: "2026-08-02T00:00:00.000Z",
    acl: { groups: ["architecture-reviewers"], classifications: ["internal"] },
  },
  {
    knowledgeId: "artifact-superseded-delivery",
    title: "Legacy premium unit delivery procedure",
    excerpt:
      "Legacy delivery procedure replaced by the verified premium unit rule.",
    artifactType: "delivery-procedure",
    product: "cgo",
    domain: "units",
    status: "superseded",
    sourceSystem: "okf",
    sourceUri: "https://okf.example.com/cgo/delivery/legacy-premium-unit",
    sourceRevision: "2025.10",
    contentHash: "sha256-superseded-delivery",
    locator: { sectionPath: "delivery.legacy", lineRange: "1-9" },
    verifiedAt: "2025-10-01T00:00:00.000Z",
    staleAfter: "2026-01-01T00:00:00.000Z",
    acl: { groups: [], classifications: ["internal"] },
    successorKnowledgeId: "artifact-public-unit-rule",
  },
];

const lineage: ArtifactLineage[] = artifacts.map((artifact) => ({
  knowledgeId: artifact.knowledgeId,
  sourceSystem: artifact.sourceSystem,
  sourceUri: artifact.sourceUri,
  sourceRevision: artifact.sourceRevision,
  status: artifact.status,
  previousKnowledgeIds: [],
  ...(artifact.successorKnowledgeId === undefined
    ? {}
    : { successorKnowledgeId: artifact.successorKnowledgeId }),
}));

const provenance: Provenance[] = artifacts.map((artifact) => ({
  knowledgeId: artifact.knowledgeId,
  contentHash: artifact.contentHash,
  canonicalUri: artifact.sourceUri,
  sourceRevision: artifact.sourceRevision,
  sourceSystem: artifact.sourceSystem,
  scope: { product: artifact.product, domain: artifact.domain },
  locator: artifact.locator,
  attestedBy: "catalog-seed",
  attestedAt: artifact.verifiedAt,
  usageRestrictions: artifact.acl.groups,
}));

const taxonomies: Taxonomy[] = [
  {
    product: "cgo",
    domain: "units",
    artifactTypes: ["rule", "architecture-decision", "delivery-procedure"],
    concepts: ["premium-unit", "unit-identifier", "delivery"],
  },
];

export const createSeedRepository = (): MemoryKnowledgeRepository =>
  new MemoryKnowledgeRepository(
    artifacts.map((artifact, index) => ({
      artifact,
      lineage: lineage[index]!,
      provenance: provenance[index]!,
    })),
    taxonomies,
  );
