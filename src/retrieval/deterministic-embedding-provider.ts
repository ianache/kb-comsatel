import { createHash } from "node:crypto";
import type {
  EmbeddingBatch,
  EmbeddingProvider,
} from "./embedding-provider.js";

export class DeterministicEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private readonly model = "local-test",
    private readonly dimension = 3,
  ) {}

  async embed(texts: readonly string[]): Promise<EmbeddingBatch> {
    return {
      model: this.model,
      dimension: this.dimension,
      vectors: texts.map((text) => {
        const digest = createHash("sha256").update(text, "utf8").digest();
        const values = Array.from(
          { length: this.dimension },
          (_value, index) => digest[index % digest.length]! / 255,
        );
        const magnitude =
          Math.sqrt(values.reduce((sum, value) => sum + value ** 2, 0)) || 1;
        return values.map((value) => value / magnitude);
      }),
    };
  }
}
