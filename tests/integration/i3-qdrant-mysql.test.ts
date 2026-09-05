import { describe, expect, it } from "vitest";

const enabled = process.env.KCP_I3_INTEGRATION === "true";

describe.skipIf(!enabled)("I3 external integration", () => {
  it("reaches the configured Qdrant collection", async () => {
    const url = process.env.KCP_I3_QDRANT_URL ?? "http://127.0.0.1:6333";
    const collection =
      process.env.KCP_I3_QDRANT_COLLECTION ?? "knowledge_chunks";
    const response = await fetch(
      `${url.replace(/\/$/u, "")}/collections/${encodeURIComponent(collection)}`,
    );
    expect(response.ok).toBe(true);
    const body = (await response.json()) as { result?: { status?: string } };
    expect(body.result).toBeDefined();
  });
});
