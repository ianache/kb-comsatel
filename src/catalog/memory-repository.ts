import { KcpError } from "../domain/errors.js";
import {
  accessPrincipalSchema,
  artifactLineageSchema,
  knowledgeFiltersSchema,
  knowledgeArtifactSchema,
  knowledgeExcerptSchema,
  provenanceSchema,
  searchKnowledgeInputSchema,
  staleConceptSchema,
  taxonomySchema,
  type AccessPrincipal,
  type ArtifactLineage,
  type KnowledgeArtifact,
  type KnowledgeFilters,
  type KnowledgeExcerpt,
  type Provenance,
  type SearchKnowledgeInput,
  type SearchKnowledgeResult,
  type StaleConcept,
  type Taxonomy,
} from "../domain/schemas.js";
import type { KnowledgeRepository } from "./repository.js";

interface CatalogEntry {
  artifact: KnowledgeArtifact;
  lineage: ArtifactLineage;
  provenance: Provenance;
}

const now = () => new Date();

export class MemoryKnowledgeRepository implements KnowledgeRepository {
  constructor(
    private readonly entries: readonly CatalogEntry[],
    private readonly taxonomies: readonly Taxonomy[],
  ) {}

  async search(
    input: SearchKnowledgeInput,
    principal: AccessPrincipal,
  ): Promise<SearchKnowledgeResult> {
    const parsedInput = this.parse(searchKnowledgeInputSchema, input);
    this.parse(accessPrincipalSchema, principal);
    const filters = parsedInput.filters ?? {};
    const queryTerms = this.terms(parsedInput.query);
    const results = this.entries
      .filter(({ artifact }) =>
        this.matchesFilters(artifact, filters, principal),
      )
      .map(({ artifact }) => ({
        artifact,
        relevanceScore: this.score(artifact, queryTerms),
      }))
      .filter(({ relevanceScore }) => relevanceScore > 0)
      .sort(
        (left, right) =>
          right.relevanceScore - left.relevanceScore ||
          left.artifact.knowledgeId.localeCompare(right.artifact.knowledgeId),
      )
      .slice(0, parsedInput.limit)
      .map(({ artifact, relevanceScore }) => ({
        knowledgeId: artifact.knowledgeId,
        excerpt: artifact.excerpt,
        relevanceScore,
        trust: this.trust(artifact),
        citation: this.citation(artifact),
      }));

    return {
      results,
      appliedFilters: filters,
      evidenceStatus: results.length > 0 ? "sufficient" : "insufficient",
      warnings: [],
    };
  }

  async getExcerpt(
    knowledgeId: string,
    principal: AccessPrincipal,
  ): Promise<KnowledgeExcerpt | null> {
    const artifact = this.findAccessible(knowledgeId, principal);
    return artifact === undefined
      ? null
      : knowledgeExcerptSchema.parse({
          knowledgeId: artifact.knowledgeId,
          excerpt: artifact.excerpt,
          citation: this.citation(artifact),
        });
  }

  async getLineage(
    knowledgeId: string,
    principal: AccessPrincipal,
  ): Promise<ArtifactLineage | null> {
    const entry = this.findAccessibleEntry(knowledgeId, principal);
    return entry === undefined
      ? null
      : artifactLineageSchema.parse(entry.lineage);
  }

  async getProvenance(
    knowledgeId: string,
    principal: AccessPrincipal,
  ): Promise<Provenance | null> {
    const entry = this.findAccessibleEntry(knowledgeId, principal);
    return entry === undefined
      ? null
      : provenanceSchema.parse(entry.provenance);
  }

  async listStale(
    filters: KnowledgeFilters,
    principal: AccessPrincipal,
  ): Promise<StaleConcept[]> {
    const parsedFilters = this.parse(knowledgeFiltersSchema, filters);
    this.parse(accessPrincipalSchema, principal);
    return this.entries
      .map(({ artifact }) => artifact)
      .filter(
        (artifact) =>
          this.matchesFilterFields(artifact, parsedFilters, principal) &&
          this.isStale(artifact),
      )
      .sort((left, right) => left.knowledgeId.localeCompare(right.knowledgeId))
      .map((artifact) =>
        staleConceptSchema.parse({
          knowledgeId: artifact.knowledgeId,
          title: artifact.title,
          staleAfter: artifact.staleAfter,
          citation: this.citation(artifact),
        }),
      );
  }

  async getArtifact(
    knowledgeId: string,
    sourceRevision: string | undefined,
    principal: AccessPrincipal,
  ): Promise<KnowledgeArtifact | null> {
    this.parse(accessPrincipalSchema, principal);
    const artifact = this.findAccessible(knowledgeId, principal);
    if (
      artifact === undefined ||
      (artifact.sourceRevision !== sourceRevision &&
        sourceRevision !== undefined)
    ) {
      return null;
    }
    return knowledgeArtifactSchema.parse(artifact);
  }

  async getTaxonomy(
    domain: string,
    principal: AccessPrincipal,
  ): Promise<Taxonomy | null> {
    this.parse(accessPrincipalSchema, principal);
    const taxonomy = this.taxonomies.find(
      (item) =>
        item.domain === domain &&
        principal.products.includes(item.product) &&
        principal.domains.includes(item.domain),
    );
    return taxonomy === undefined ? null : taxonomySchema.parse(taxonomy);
  }

  private findAccessible(
    knowledgeId: string,
    principal: AccessPrincipal,
  ): KnowledgeArtifact | undefined {
    return this.findAccessibleEntry(knowledgeId, principal)?.artifact;
  }

  private findAccessibleEntry(
    knowledgeId: string,
    principal: AccessPrincipal,
  ): CatalogEntry | undefined {
    this.parse(accessPrincipalSchema, principal);
    return this.entries.find(
      ({ artifact }) =>
        artifact.knowledgeId === knowledgeId &&
        this.isAccessible(artifact, principal),
    );
  }

  private matchesFilters(
    artifact: KnowledgeArtifact,
    input: SearchKnowledgeInput["filters"],
    principal: AccessPrincipal,
  ): boolean {
    return (
      this.matchesFilterFields(artifact, input, principal) &&
      (input?.staleAllowed === true || !this.isStale(artifact))
    );
  }

  private matchesFilterFields(
    artifact: KnowledgeArtifact,
    input: KnowledgeFilters | undefined,
    principal: AccessPrincipal,
  ): boolean {
    return (
      this.isAccessible(artifact, principal) &&
      (input?.product === undefined ||
        input.product.includes(artifact.product)) &&
      (input?.domain === undefined || input.domain.includes(artifact.domain)) &&
      (input?.artifactType === undefined ||
        input.artifactType.includes(artifact.artifactType)) &&
      (input?.status === undefined || input.status.includes(artifact.status)) &&
      (input?.sourceSystem === undefined ||
        input.sourceSystem.includes(artifact.sourceSystem)) &&
      (input?.verifiedOnly !== true || artifact.verifiedAt !== undefined)
    );
  }

  private isAccessible(
    artifact: KnowledgeArtifact,
    principal: AccessPrincipal,
  ): boolean {
    return (
      principal.products.includes(artifact.product) &&
      principal.domains.includes(artifact.domain) &&
      artifact.acl.groups.every((group) => principal.groups.includes(group)) &&
      artifact.acl.classifications.every((classification) =>
        principal.classifications.includes(classification),
      )
    );
  }

  private isStale(artifact: KnowledgeArtifact): boolean {
    return (
      artifact.status === "stale" ||
      (artifact.staleAfter !== undefined &&
        new Date(artifact.staleAfter) <= now())
    );
  }

  private citation(artifact: KnowledgeArtifact) {
    return {
      knowledgeId: artifact.knowledgeId,
      title: artifact.title,
      sourceUri: artifact.sourceUri,
      sourceRevision: artifact.sourceRevision,
      sourceSystem: artifact.sourceSystem,
      scope: { product: artifact.product, domain: artifact.domain },
      locator: artifact.locator,
      status: artifact.status,
      ...(artifact.verifiedAt === undefined
        ? {}
        : { verifiedAt: artifact.verifiedAt }),
    };
  }

  private score(
    artifact: KnowledgeArtifact,
    queryTerms: readonly string[],
  ): number {
    const artifactTerms = new Set(
      this.terms(`${artifact.title} ${artifact.excerpt}`),
    );
    return (
      queryTerms.filter((term) => artifactTerms.has(term)).length /
      queryTerms.length
    );
  }

  private terms(value: string): string[] {
    return [...new Set(value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])];
  }

  private trust(
    artifact: KnowledgeArtifact,
  ): "verified" | "unverified" | "stale" | "deprecated" {
    if (this.isStale(artifact)) return "stale";
    if (artifact.status === "deprecated" || artifact.status === "superseded")
      return "deprecated";
    return artifact.verifiedAt === undefined ? "unverified" : "verified";
  }

  private parse<T>(
    schema: { safeParse(value: unknown): { success: boolean; data?: T } },
    value: unknown,
  ): T {
    const result = schema.safeParse(value);
    if (!result.success || result.data === undefined) {
      throw new KcpError("INVALID_INPUT", "Invalid repository input");
    }
    return result.data;
  }
}
