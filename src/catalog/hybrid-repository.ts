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
import type { KnowledgeRepository } from "./repository.js";
import type { ChunkReader } from "../retrieval/chunk-reader.js";
import type { EmbeddingProvider } from "../retrieval/embedding-provider.js";
import {
  fuseSearchResults,
  vectorCandidatesFromHydrated,
} from "../retrieval/score-fusion.js";
import type { VectorStore } from "../retrieval/vector-store.js";

export interface HybridRepositoryOptions {
  lexicalWeight: number;
  vectorWeight: number;
  candidateMultiplier: number;
}

export class HybridKnowledgeRepository implements KnowledgeRepository {
  constructor(
    private readonly lexical: KnowledgeRepository,
    private readonly chunks: ChunkReader,
    private readonly vectors: VectorStore,
    private readonly embeddings: EmbeddingProvider,
    private readonly options: HybridRepositoryOptions,
  ) {}

  async search(
    input: SearchKnowledgeInput,
    principal: AccessPrincipal,
  ): Promise<SearchKnowledgeResult> {
    const candidateLimit = Math.min(
      60,
      input.limit * this.options.candidateMultiplier,
    );
    const lexicalPromise = this.lexical.search(input, principal);
    const embeddingPromise = this.embeddings.embed([input.query]);
    const [lexical, embedding] = await Promise.all([
      lexicalPromise,
      embeddingPromise,
    ]);
    let vectorCandidates: SearchKnowledgeResult["results"] = [];
    try {
      const vectors = await this.vectors.search({
        vector: embedding.vectors[0] ?? [],
        principal,
        limit: candidateLimit,
        filters: input.filters,
      });
      const hydrated = await this.chunks.readSearchItems(
        vectors.map((item) => item.id),
        principal,
      );
      vectorCandidates = fuseSearchResults(
        [],
        vectorCandidatesFromHydrated(vectors, hydrated),
        candidateLimit,
        { lexicalWeight: 0, vectorWeight: 1 },
      );
      return {
        results: fuseSearchResults(
          lexical.results,
          vectorCandidates.map((result) => ({
            chunkId: result.knowledgeId,
            score: result.relevanceScore,
            result,
          })),
          input.limit,
          this.options,
        ),
        appliedFilters: input.filters ?? {},
        evidenceStatus:
          lexical.results.length > 0 || vectorCandidates.length > 0
            ? "sufficient"
            : "insufficient",
        warnings: lexical.warnings,
      };
    } catch {
      if (lexical.results.length === 0)
        throw new Error("Hybrid retrieval unavailable");
      return lexical;
    }
  }

  getExcerpt(
    id: string,
    principal: AccessPrincipal,
  ): Promise<KnowledgeExcerpt | null> {
    return this.lexical.getExcerpt(id, principal);
  }
  getLineage(
    id: string,
    principal: AccessPrincipal,
  ): Promise<ArtifactLineage | null> {
    return this.lexical.getLineage(id, principal);
  }
  getProvenance(
    id: string,
    principal: AccessPrincipal,
  ): Promise<Provenance | null> {
    return this.lexical.getProvenance(id, principal);
  }
  listStale(
    filters: KnowledgeFilters,
    principal: AccessPrincipal,
  ): Promise<StaleConcept[]> {
    return this.lexical.listStale(filters, principal);
  }
  getArtifact(
    id: string,
    revision: string | undefined,
    principal: AccessPrincipal,
  ): Promise<KnowledgeArtifact | null> {
    return this.lexical.getArtifact(id, revision, principal);
  }
  getTaxonomy(
    domain: string,
    principal: AccessPrincipal,
  ): Promise<Taxonomy | null> {
    return this.lexical.getTaxonomy(domain, principal);
  }
}
