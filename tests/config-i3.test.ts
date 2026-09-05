import { expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

it("loads I3 disabled with deterministic local defaults", () => {
  expect(loadConfig({})).toMatchObject({
    i3Enabled: false,
    i3QdrantEnabled: false,
    i3QdrantUrl: "http://127.0.0.1:6333",
    i3QdrantCollection: "knowledge_chunks",
    i3VectorDimension: 3,
    i3EmbeddingModel: "local-test",
    i3ChunkTargetChars: 1200,
    i3ChunkOverlapChars: 160,
    i3ChunkMaxChars: 1800,
  });
});

it("rejects enabled I3 without Qdrant and embedding configuration", () => {
  expect(() => loadConfig({ KCP_I3_ENABLED: "true" })).toThrow(
    "Qdrant must be enabled",
  );
});

it("allows explicit deterministic local I3 mode", () => {
  expect(
    loadConfig({
      KCP_I3_ENABLED: "true",
      KCP_I3_QDRANT_ENABLED: "true",
      KCP_I3_EMBEDDING_MODEL: "local-test",
    }),
  ).toMatchObject({ i3Enabled: true, i3QdrantEnabled: true });
});
