import type { AppConfig } from "../config.js";
import { MySqlCatalogWriter } from "../catalog/mysql-catalog-writer.js";
import { HybridKnowledgeRepository } from "../catalog/hybrid-repository.js";
import type { RuntimeDependencies } from "../ops/runtime-dependencies.js";
import { DeterministicEmbeddingProvider } from "./deterministic-embedding-provider.js";
import { FilesystemDocumentSource } from "./filesystem-document-source.js";
import { HttpEmbeddingProvider } from "./http-embedding-provider.js";
import { IngestionIndexer } from "./ingestion-indexer.js";
import { QdrantVectorStore } from "./qdrant-vector-store.js";
import type { KnowledgeRepository } from "../catalog/repository.js";
import type { EmbeddingProvider } from "./embedding-provider.js";
import type { VectorStore } from "./vector-store.js";
import type { ChunkReader } from "./chunk-reader.js";

export interface I3Runtime {
  repository: KnowledgeRepository;
  indexer: IngestionIndexer;
  vectorStore: VectorStore;
  close(): Promise<void>;
}

export async function createI3Runtime(
  config: AppConfig,
  dependencies: RuntimeDependencies,
): Promise<I3Runtime> {
  if (!config.i3Enabled) throw new Error("I3 is not enabled");
  if (!dependencies.executor) throw new Error("I3 requires MySQL executor");
  if (!("readSearchItems" in dependencies.repository)) {
    throw new Error("I3 requires a chunk-capable repository");
  }

  const vectorStore = new QdrantVectorStore({
    url: config.i3QdrantUrl,
    collection: config.i3QdrantCollection,
  });
  try {
    await vectorStore.ensureCollection({
      name: config.i3QdrantCollection,
      dimension: config.i3VectorDimension,
      distance: config.i3VectorDistance,
      model: config.i3EmbeddingModel,
    });
    await vectorStore.health();
    const embeddings: EmbeddingProvider =
      config.i3EmbeddingModel === "local-test"
        ? new DeterministicEmbeddingProvider(
            config.i3EmbeddingModel,
            config.i3VectorDimension,
          )
        : new HttpEmbeddingProvider({
            url: config.i3EmbeddingUrl!,
            model: config.i3EmbeddingModel,
            apiKey: config.i3EmbeddingApiKey,
            dimension: config.i3VectorDimension,
            timeoutMs: config.i3EmbeddingTimeoutMs,
          });
    const source = new FilesystemDocumentSource({
      directory: config.i3SourceDir,
    });
    const writer = new MySqlCatalogWriter(dependencies.executor);
    const indexer = new IngestionIndexer(
      source,
      embeddings,
      vectorStore,
      writer,
      {
        chunk: {
          targetChars: config.i3ChunkTargetChars,
          overlapChars: config.i3ChunkOverlapChars,
          maxChars: config.i3ChunkMaxChars,
        },
      },
    );
    const repository = new HybridKnowledgeRepository(
      dependencies.repository,
      dependencies.repository as unknown as ChunkReader,
      vectorStore,
      embeddings,
      {
        lexicalWeight: config.i3LexicalWeight,
        vectorWeight: config.i3VectorWeight,
        candidateMultiplier: config.i3CandidateMultiplier,
      },
    );
    return {
      repository,
      indexer,
      vectorStore,
      close: () => vectorStore.close(),
    };
  } catch (error) {
    await vectorStore.close();
    throw error;
  }
}
