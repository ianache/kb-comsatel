import type { AccessPrincipal } from "../domain/schemas.js";

export type VectorDistance = "Cosine" | "Euclid" | "Dot";

export interface VectorCollectionSpec {
  name: string;
  dimension: number;
  distance: VectorDistance;
  model: string;
}

export interface VectorPayload {
  chunkId: string;
  knowledgeId: string;
  sourceRevision: string;
  product: string;
  domain: string;
  classification: string;
  status: string;
  sourceSystem: string;
  verified: boolean;
  stale: boolean;
}

export interface VectorPoint {
  id: string;
  vector: number[];
  payload: VectorPayload;
}

export interface VectorSearchResult {
  id: string;
  score: number;
  payload: VectorPayload;
}

export interface VectorSearchRequest {
  vector: number[];
  principal: AccessPrincipal;
  limit: number;
  filters?: {
    product?: string[];
    domain?: string[];
    status?: string[];
  };
}

export interface VectorStore {
  ensureCollection(spec: VectorCollectionSpec): Promise<void>;
  upsert(points: readonly VectorPoint[]): Promise<void>;
  deleteByRevision(knowledgeId: string, sourceRevision: string): Promise<void>;
  search(request: VectorSearchRequest): Promise<VectorSearchResult[]>;
  health(): Promise<void>;
  close(): Promise<void>;
}
