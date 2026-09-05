import {
  artifactLineageSchema,
  citationSchema,
  knowledgeArtifactSchema,
  knowledgeExcerptSchema,
  provenanceSchema,
  staleConceptSchema,
  taxonomySchema,
  type ArtifactLineage,
  type Citation,
  type KnowledgeArtifact,
  type KnowledgeExcerpt,
  type Provenance,
  type StaleConcept,
  type Taxonomy,
} from "../domain/schemas.js";

export type KnowledgeRow = Record<string, unknown>;

function text(row: KnowledgeRow, name: string): string {
  return String(row[name] ?? "");
}

function optionalText(row: KnowledgeRow, name: string): string | undefined {
  const value = row[name];
  return value === null || value === undefined ? undefined : String(value);
}

function array(row: KnowledgeRow, name: string): string[] {
  const value = row[name];
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string" && value.length > 0) {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }
  return [];
}

export function mapCitation(row: KnowledgeRow): Citation {
  return citationSchema.parse({
    knowledgeId: text(row, "knowledge_id"),
    title: text(row, "title"),
    sourceUri: text(row, "source_uri"),
    sourceRevision: text(row, "source_revision"),
    sourceSystem: text(row, "source_system"),
    scope: { product: text(row, "product"), domain: text(row, "domain") },
    locator: {
      ...(optionalText(row, "section_path") === undefined
        ? {}
        : { sectionPath: optionalText(row, "section_path") }),
      ...(optionalText(row, "page_range") === undefined
        ? {}
        : { pageRange: optionalText(row, "page_range") }),
      ...(optionalText(row, "line_range") === undefined
        ? {}
        : { lineRange: optionalText(row, "line_range") }),
    },
    status: text(row, "current_status"),
    ...(optionalText(row, "verified_at") === undefined
      ? {}
      : { verifiedAt: optionalText(row, "verified_at") }),
  });
}

export function mapArtifact(row: KnowledgeRow): KnowledgeArtifact {
  return knowledgeArtifactSchema.parse({
    knowledgeId: text(row, "knowledge_id"),
    title: text(row, "title"),
    excerpt: text(row, "excerpt"),
    artifactType: text(row, "artifact_type"),
    product: text(row, "product"),
    domain: text(row, "domain"),
    status: text(row, "current_status"),
    sourceSystem: text(row, "source_system"),
    sourceUri: text(row, "source_uri"),
    sourceRevision: text(row, "source_revision"),
    contentHash: text(row, "content_hash"),
    locator: {
      ...(optionalText(row, "section_path") === undefined
        ? {}
        : { sectionPath: optionalText(row, "section_path") }),
      ...(optionalText(row, "page_range") === undefined
        ? {}
        : { pageRange: optionalText(row, "page_range") }),
      ...(optionalText(row, "line_range") === undefined
        ? {}
        : { lineRange: optionalText(row, "line_range") }),
    },
    ...(optionalText(row, "verified_at") === undefined
      ? {}
      : { verifiedAt: optionalText(row, "verified_at") }),
    ...(optionalText(row, "stale_after") === undefined
      ? {}
      : { staleAfter: optionalText(row, "stale_after") }),
    acl: {
      groups: array(row, "acl_groups"),
      classifications: array(row, "acl_classifications"),
    },
    ...(optionalText(row, "successor_knowledge_id") === undefined
      ? {}
      : { successorKnowledgeId: optionalText(row, "successor_knowledge_id") }),
  });
}

export function mapExcerpt(row: KnowledgeRow): KnowledgeExcerpt {
  return knowledgeExcerptSchema.parse({
    knowledgeId: text(row, "knowledge_id"),
    excerpt: text(row, "excerpt"),
    citation: mapCitation(row),
  });
}

export function mapLineage(row: KnowledgeRow): ArtifactLineage {
  return artifactLineageSchema.parse({
    knowledgeId: text(row, "knowledge_id"),
    sourceSystem: text(row, "source_system"),
    sourceUri: text(row, "source_uri"),
    sourceRevision: text(row, "source_revision"),
    status: text(row, "current_status"),
    previousKnowledgeIds: array(row, "previous_knowledge_ids"),
    ...(optionalText(row, "successor_knowledge_id") === undefined
      ? {}
      : { successorKnowledgeId: optionalText(row, "successor_knowledge_id") }),
    ...(optionalText(row, "valid_from") === undefined
      ? {}
      : { validFrom: optionalText(row, "valid_from") }),
    ...(optionalText(row, "valid_until") === undefined
      ? {}
      : { validUntil: optionalText(row, "valid_until") }),
  });
}

export function mapProvenance(row: KnowledgeRow): Provenance {
  return provenanceSchema.parse({
    knowledgeId: text(row, "knowledge_id"),
    contentHash: text(row, "content_hash"),
    canonicalUri: text(row, "source_uri"),
    sourceRevision: text(row, "source_revision"),
    sourceSystem: text(row, "source_system"),
    scope: { product: text(row, "product"), domain: text(row, "domain") },
    locator: {
      ...(optionalText(row, "section_path") === undefined
        ? {}
        : { sectionPath: optionalText(row, "section_path") }),
      ...(optionalText(row, "page_range") === undefined
        ? {}
        : { pageRange: optionalText(row, "page_range") }),
      ...(optionalText(row, "line_range") === undefined
        ? {}
        : { lineRange: optionalText(row, "line_range") }),
    },
    ...(optionalText(row, "attested_by") === undefined
      ? {}
      : { attestedBy: optionalText(row, "attested_by") }),
    ...(optionalText(row, "attested_at") === undefined
      ? {}
      : { attestedAt: optionalText(row, "attested_at") }),
    usageRestrictions: array(row, "usage_restrictions"),
  });
}

export function mapStale(row: KnowledgeRow): StaleConcept {
  return staleConceptSchema.parse({
    knowledgeId: text(row, "knowledge_id"),
    title: text(row, "title"),
    staleAfter: text(row, "stale_after"),
    citation: mapCitation(row),
  });
}

export function mapTaxonomy(row: KnowledgeRow): Taxonomy {
  return taxonomySchema.parse({
    domain: text(row, "domain"),
    product: text(row, "product"),
    artifactTypes: array(row, "artifact_types"),
    concepts: array(row, "concepts"),
  });
}
