import { expect, it } from "vitest";
import type {
  CatalogWriter,
  IndexRunInput,
} from "../../src/retrieval/catalog-writer.js";
import type { DocumentSource } from "../../src/retrieval/document-source.js";
import type {
  EmbeddingBatch,
  EmbeddingProvider,
} from "../../src/retrieval/embedding-provider.js";
import type { SourceDocument } from "../../src/retrieval/source-document.js";
import type {
  VectorCollectionSpec,
  VectorStore,
} from "../../src/retrieval/vector-store.js";

it("accepts independent fakes for I3 retrieval boundaries", async () => {
  const source: DocumentSource = {
    list: async function* (): AsyncGenerator<SourceDocument> {},
  };
  const embeddings: EmbeddingProvider = {
    embed: async (texts): Promise<EmbeddingBatch> => ({
      model: "test",
      dimension: 3,
      vectors: texts.map(() => [0, 0, 0]),
    }),
  };
  const vectors: VectorStore = {
    ensureCollection: async (_spec: VectorCollectionSpec) => undefined,
    upsert: async () => undefined,
    deleteByRevision: async () => undefined,
    search: async () => [],
    health: async () => undefined,
    close: async () => undefined,
  };
  const catalog: CatalogWriter = {
    beginIndexRun: async (_input: IndexRunInput) => "run-1",
    upsertDocument: async () => undefined,
    replaceChunks: async () => undefined,
    completeIndexRun: async () => undefined,
    failIndexRun: async () => undefined,
  };

  expect(source.list).toBeTypeOf("function");
  expect((await embeddings.embed(["one", "two"])).vectors).toHaveLength(2);
  await vectors.health();
  expect(
    await catalog.beginIndexRun({
      knowledgeId: "k1",
      sourceRevision: "r1",
      model: "test",
      dimension: 3,
    }),
  ).toBe("run-1");
});
