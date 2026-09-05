import { expect, it } from "vitest";
import { toSafeError } from "../../src/mcp/tools.js";
import { httpErrorResponse } from "../../src/mcp/http-errors.js";
import { HttpEmbeddingProvider } from "../../src/retrieval/http-embedding-provider.js";

it("keeps I3 failures free of credentials, prompts, SQL, and source text", async () => {
  const secret = "sk-live-secret.jwt.payload";
  const source = "private document body";
  const safe = JSON.stringify(
    toSafeError("search_knowledge", new Error(`${secret} SELECT ${source}`)),
  );
  expect(safe).not.toContain(secret);
  expect(safe).not.toContain(source);
  expect(
    JSON.stringify(httpErrorResponse(new Error(`${secret} ${source}`))),
  ).not.toContain(secret);

  const provider = new HttpEmbeddingProvider({
    url: "https://embedding.example.test/v1/embeddings",
    model: "test",
    dimension: 3,
    apiKey: secret,
    timeoutMs: 50,
    fetcher: async () => {
      throw new Error(`${secret} ${source}`);
    },
  });
  await expect(provider.embed([source])).rejects.not.toThrow(secret);
  await expect(provider.embed([source])).rejects.not.toThrow(source);
});
