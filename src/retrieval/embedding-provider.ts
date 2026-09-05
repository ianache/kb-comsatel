export interface EmbeddingBatch {
  model: string;
  dimension: number;
  vectors: number[][];
}

export interface EmbeddingProvider {
  embed(texts: readonly string[]): Promise<EmbeddingBatch>;
}
