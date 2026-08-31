import type {
  AccessPrincipal,
  ArtifactLineage,
  KnowledgeArtifact,
  KnowledgeExcerpt,
  KnowledgeFilters,
  Provenance,
  SearchKnowledgeInput,
  SearchKnowledgeResult,
  StaleConcept,
  Taxonomy,
} from "../domain/schemas.js";

export interface KnowledgeRepository {
  search(
    input: SearchKnowledgeInput,
    principal: AccessPrincipal,
  ): Promise<SearchKnowledgeResult>;
  getExcerpt(
    knowledgeId: string,
    principal: AccessPrincipal,
  ): Promise<KnowledgeExcerpt | null>;
  getLineage(
    knowledgeId: string,
    principal: AccessPrincipal,
  ): Promise<ArtifactLineage | null>;
  getProvenance(
    knowledgeId: string,
    principal: AccessPrincipal,
  ): Promise<Provenance | null>;
  listStale(
    filters: KnowledgeFilters,
    principal: AccessPrincipal,
  ): Promise<StaleConcept[]>;
  getArtifact(
    knowledgeId: string,
    sourceRevision: string | undefined,
    principal: AccessPrincipal,
  ): Promise<KnowledgeArtifact | null>;
  getTaxonomy(
    domain: string,
    principal: AccessPrincipal,
  ): Promise<Taxonomy | null>;
}
