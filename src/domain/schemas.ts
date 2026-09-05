import { z } from "zod";

const identifierSchema = z.string().trim().min(1);
const uriSchema = z.string().url();
const timestampSchema = z.string().datetime();
const stringListSchema = z.array(identifierSchema);

export const knowledgeStatusSchema = z.enum([
  "stable",
  "draft",
  "stale",
  "deprecated",
  "superseded",
  "archived",
]);

export const sourceSystemSchema = z.enum([
  "gitlab",
  "google-drive",
  "okf",
  "schema-catalog",
]);

export const knowledgeFiltersSchema = z
  .object({
    product: stringListSchema.optional(),
    domain: stringListSchema.optional(),
    artifactType: stringListSchema.optional(),
    status: z.array(knowledgeStatusSchema).optional(),
    verifiedOnly: z.boolean().optional(),
    staleAllowed: z.boolean().optional(),
    sourceSystem: z.array(sourceSystemSchema).optional(),
  })
  .strict();

export const locatorSchema = z
  .object({
    sectionPath: identifierSchema.optional(),
    pageRange: identifierSchema.optional(),
    lineRange: identifierSchema.optional(),
  })
  .strict();

export const knowledgeScopeSchema = z
  .object({
    product: identifierSchema,
    domain: identifierSchema,
  })
  .strict();

export const citationSchema = z
  .object({
    knowledgeId: identifierSchema,
    title: identifierSchema,
    sourceUri: uriSchema,
    sourceRevision: identifierSchema,
    sourceSystem: sourceSystemSchema,
    scope: knowledgeScopeSchema,
    locator: locatorSchema.optional(),
    status: knowledgeStatusSchema,
    verifiedAt: timestampSchema.optional(),
  })
  .strict();

export const searchKnowledgeInputSchema = z
  .object({
    query: identifierSchema,
    filters: knowledgeFiltersSchema.optional(),
    limit: z.number().int().min(1).max(20).default(8),
  })
  .strict();

const searchResultItemSchema = z
  .object({
    knowledgeId: identifierSchema,
    excerpt: identifierSchema,
    relevanceScore: z.number().finite(),
    trust: z.enum(["verified", "unverified", "stale", "deprecated"]),
    citation: citationSchema,
  })
  .strict();

export const searchKnowledgeResultSchema = z
  .object({
    results: z.array(searchResultItemSchema),
    appliedFilters: knowledgeFiltersSchema,
    evidenceStatus: z.enum(["sufficient", "insufficient"]),
    warnings: z
      .array(z.enum(["draft", "deprecated", "superseded", "stale"]))
      .default([]),
  })
  .strict();

export const buildContextPackInputSchema = z
  .object({
    task: identifierSchema,
    product: identifierSchema,
    tokenBudget: z.number().int().min(500).max(12000),
    filters: knowledgeFiltersSchema,
  })
  .strict();

export const accessPrincipalSchema = z
  .object({
    id: identifierSchema,
    roles: stringListSchema,
    groups: stringListSchema,
    products: stringListSchema,
    domains: stringListSchema,
    classifications: stringListSchema,
  })
  .strict();

export const knowledgeArtifactSchema = z
  .object({
    knowledgeId: identifierSchema,
    title: identifierSchema,
    excerpt: identifierSchema,
    artifactType: identifierSchema,
    product: identifierSchema,
    domain: identifierSchema,
    status: knowledgeStatusSchema,
    sourceSystem: sourceSystemSchema,
    sourceUri: uriSchema,
    sourceRevision: identifierSchema,
    contentHash: identifierSchema,
    locator: locatorSchema,
    verifiedAt: timestampSchema.optional(),
    staleAfter: timestampSchema.optional(),
    acl: z
      .object({
        groups: stringListSchema,
        classifications: stringListSchema,
      })
      .strict(),
    successorKnowledgeId: identifierSchema.optional(),
  })
  .strict();

export const knowledgeExcerptSchema = z
  .object({
    knowledgeId: identifierSchema,
    excerpt: identifierSchema,
    citation: citationSchema,
  })
  .strict();

export const artifactLineageSchema = z
  .object({
    knowledgeId: identifierSchema,
    sourceSystem: sourceSystemSchema,
    sourceUri: uriSchema,
    sourceRevision: identifierSchema,
    status: knowledgeStatusSchema,
    previousKnowledgeIds: stringListSchema,
    successorKnowledgeId: identifierSchema.optional(),
    validFrom: timestampSchema.optional(),
    validUntil: timestampSchema.optional(),
  })
  .strict();

export const provenanceSchema = z
  .object({
    knowledgeId: identifierSchema,
    contentHash: identifierSchema,
    canonicalUri: uriSchema,
    sourceRevision: identifierSchema,
    sourceSystem: sourceSystemSchema,
    scope: knowledgeScopeSchema,
    locator: locatorSchema.optional(),
    attestedBy: identifierSchema.optional(),
    attestedAt: timestampSchema.optional(),
    usageRestrictions: stringListSchema,
  })
  .strict();

const citedFactSchema = z
  .object({
    text: identifierSchema,
    citation: citationSchema,
  })
  .strict();

export const contextPackSchema = z
  .object({
    restrictions: stringListSchema,
    facts: z.array(citedFactSchema),
    decisions: z.array(citedFactSchema),
    relatedArtifacts: z.array(citationSchema),
    conflicts: stringListSchema,
    missingKnowledge: stringListSchema,
    excerpts: z.array(knowledgeExcerptSchema),
    citations: z.array(citationSchema),
    estimatedTokens: z.number().int().min(0),
    evidenceStatus: z.enum(["sufficient", "insufficient"]),
  })
  .strict();

export const staleConceptSchema = z
  .object({
    knowledgeId: identifierSchema,
    title: identifierSchema,
    staleAfter: timestampSchema,
    citation: citationSchema,
  })
  .strict();

export const taxonomySchema = z
  .object({
    domain: identifierSchema,
    product: identifierSchema,
    artifactTypes: stringListSchema,
    concepts: stringListSchema,
  })
  .strict();

export type KnowledgeFilters = z.infer<typeof knowledgeFiltersSchema>;
export type Citation = z.infer<typeof citationSchema>;
export type SearchKnowledgeInput = z.infer<typeof searchKnowledgeInputSchema>;
export type SearchKnowledgeResult = z.infer<typeof searchKnowledgeResultSchema>;
export type AccessPrincipal = z.infer<typeof accessPrincipalSchema>;
export type KnowledgeArtifact = z.infer<typeof knowledgeArtifactSchema>;
export type KnowledgeExcerpt = z.infer<typeof knowledgeExcerptSchema>;
export type ArtifactLineage = z.infer<typeof artifactLineageSchema>;
export type Provenance = z.infer<typeof provenanceSchema>;
export type ContextPack = z.infer<typeof contextPackSchema>;
export type StaleConcept = z.infer<typeof staleConceptSchema>;
export type Taxonomy = z.infer<typeof taxonomySchema>;
