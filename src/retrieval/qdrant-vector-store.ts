import { KcpError } from "../domain/errors.js";
import type {
  VectorCollectionSpec,
  VectorPoint,
  VectorSearchResult,
  VectorStore,
  VectorSearchRequest,
} from "./vector-store.js";
import { buildVectorFilter } from "./vector-filters.js";

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface QdrantVectorStoreOptions {
  url: string;
  collection: string;
  fetcher?: Fetcher;
}

export class QdrantVectorStore implements VectorStore {
  private readonly fetcher: Fetcher;
  private readonly baseUrl: string;

  constructor(private readonly options: QdrantVectorStoreOptions) {
    this.fetcher = options.fetcher ?? globalThis.fetch;
    this.baseUrl = `${options.url.replace(/\/$/u, "")}/collections/${encodeURIComponent(options.collection)}`;
  }

  async ensureCollection(spec: VectorCollectionSpec): Promise<void> {
    const response = await this.request(this.baseUrl, { method: "GET" }, true);
    if (response.status === 404) {
      await this.request(this.baseUrl, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          vectors: { size: spec.dimension, distance: spec.distance },
        }),
      });
      return;
    }
    const body = (await response.json()) as {
      result?: {
        config?: {
          params?: { vectors?: { size?: number; distance?: string } };
        };
      };
    };
    const vectors = body.result?.config?.params?.vectors;
    if (
      vectors?.size !== spec.dimension ||
      vectors.distance !== spec.distance
    ) {
      throw new KcpError("INTERNAL_ERROR", "Vector collection incompatible");
    }
  }

  async upsert(points: readonly VectorPoint[]): Promise<void> {
    if (points.length === 0) return;
    await this.request(`${this.baseUrl}/points?wait=true`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ points }),
    });
  }

  async deleteByRevision(
    knowledgeId: string,
    sourceRevision: string,
  ): Promise<void> {
    await this.request(`${this.baseUrl}/points/delete?wait=true`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        filter: {
          must: [
            { key: "knowledge_id", match: { value: knowledgeId } },
            { key: "source_revision", match: { value: sourceRevision } },
          ],
        },
      }),
    });
  }

  async search(request: VectorSearchRequest): Promise<VectorSearchResult[]> {
    const limit = Math.max(1, Math.min(60, Math.floor(request.limit)));
    const response = await this.request(`${this.baseUrl}/points/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: request.vector,
        limit,
        with_payload: true,
        filter: buildVectorFilter(request.principal),
      }),
    });
    const body = (await response.json()) as {
      result?:
        | {
            points?: Array<{
              id?: unknown;
              score?: unknown;
              payload?: unknown;
            }>;
          }
        | Array<{ id?: unknown; score?: unknown; payload?: unknown }>;
    };
    const points = Array.isArray(body.result)
      ? body.result
      : (body.result?.points ?? []);
    return points.flatMap((point) =>
      typeof point.id === "string" &&
      typeof point.score === "number" &&
      point.payload !== undefined
        ? [
            {
              id: point.id,
              score: point.score,
              payload: point.payload as VectorSearchResult["payload"],
            },
          ]
        : [],
    );
  }

  async health(): Promise<void> {
    await this.request(this.baseUrl, { method: "GET" });
  }

  async close(): Promise<void> {}

  private async request(
    url: string,
    init: RequestInit,
    allowNotFound = false,
  ): Promise<Response> {
    try {
      const response = await this.fetcher(url, init);
      if (!response.ok && !(allowNotFound && response.status === 404)) {
        throw new Error("vector store request failed");
      }
      return response;
    } catch {
      throw new KcpError("INTERNAL_ERROR", "Vector store unavailable");
    }
  }
}
