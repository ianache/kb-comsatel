import type {
  AccessPrincipal,
  KnowledgeFilters,
  SearchKnowledgeResult,
} from "../domain/schemas.js";

export interface HydratedChunk {
  chunkId: string;
  result: SearchKnowledgeResult["results"][number];
}

export interface ChunkReader {
  readSearchItems(
    chunkIds: readonly string[],
    principal: AccessPrincipal,
    filters?: KnowledgeFilters,
  ): Promise<HydratedChunk[]>;
}
