import { KcpError } from "../domain/errors.js";
import type {
  EmbeddingBatch,
  EmbeddingProvider,
} from "./embedding-provider.js";

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface HttpEmbeddingProviderOptions {
  url: string;
  model: string;
  dimension: number;
  timeoutMs: number;
  apiKey?: string;
  fetcher?: Fetcher;
}

export class HttpEmbeddingProvider implements EmbeddingProvider {
  private readonly fetcher: Fetcher;

  constructor(private readonly options: HttpEmbeddingProviderOptions) {
    this.fetcher = options.fetcher ?? globalThis.fetch;
  }

  async embed(texts: readonly string[]): Promise<EmbeddingBatch> {
    if (texts.length === 0) {
      return {
        model: this.options.model,
        dimension: this.options.dimension,
        vectors: [],
      };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await this.fetcher(this.options.url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          ...(this.options.apiKey
            ? { authorization: `Bearer ${this.options.apiKey}` }
            : {}),
        },
        body: JSON.stringify({ model: this.options.model, input: texts }),
      });
      if (!response.ok) throw new Error("embedding endpoint returned an error");
      const body = (await response.json()) as {
        data?: Array<{ embedding?: unknown }>;
        embeddings?: unknown;
      };
      const vectors = Array.isArray(body.embeddings)
        ? body.embeddings
        : Array.isArray(body.data)
          ? body.data.map((item) => item.embedding)
          : undefined;
      if (
        !Array.isArray(vectors) ||
        vectors.length !== texts.length ||
        !vectors.every(
          (vector) =>
            Array.isArray(vector) &&
            vector.length === this.options.dimension &&
            vector.every(
              (value) => typeof value === "number" && Number.isFinite(value),
            ),
        )
      ) {
        throw new Error("invalid embedding response");
      }
      return {
        model: this.options.model,
        dimension: this.options.dimension,
        vectors: vectors as number[][],
      };
    } catch {
      throw new KcpError("INTERNAL_ERROR", "Embedding response unavailable");
    } finally {
      clearTimeout(timer);
    }
  }
}
