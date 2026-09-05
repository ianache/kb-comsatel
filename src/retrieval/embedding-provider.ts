export interface EmbeddingBatch {
  model: string;
  dimension: number;
  vectors: number[][];
}

export interface EmbeddingProvider {
  readonly model?: string;
  readonly dimension?: number;
  embed(texts: readonly string[]): Promise<EmbeddingBatch>;
}
