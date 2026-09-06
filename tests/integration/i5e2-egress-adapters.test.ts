import { describe, expect, it, vi } from "vitest";
import { GitLabHttpSourceAdapter } from "../../src/ingestion/gitlab-http-source-adapter.js";
import { GitLabHttpAdapter } from "../../src/publication/gitlab-http-adapter.js";
import { QdrantVectorStore } from "../../src/retrieval/qdrant-vector-store.js";
import { createEgressPolicy } from "../../src/security/egress-policy.js";

const allowedHosts = {
  gitlab: ["gitlab.example.com"],
  "gitlab-source": ["gitlab.example.com"],
  drive: ["drive.example.com"],
  embedding: ["embedding.example.com"],
  qdrant: ["qdrant.example.com"],
  oidc: ["auth.example.com"],
};

function egressPolicy() {
  return createEgressPolicy({
    allowHttp: false,
    allowedHosts,
    dnsLookup: async () => ["93.184.216.34"],
  });
}

describe("I5-E2 outbound adapter egress", () => {
  it("rejects GitLab source requests before fetch", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ id: "sha" })));
    const adapter = new GitLabHttpSourceAdapter({
      baseUrl: "https://untrusted.example.com",
      token: "token",
      fetcher,
      egressPolicy: egressPolicy(),
    });

    await expect(
      adapter.resolveRevision({ projectId: "1", ref: "main" }),
    ).rejects.toMatchObject({ code: "EGRESS_DENIED" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects GitLab publication requests before fetch", async () => {
    const fetcher = vi.fn(async () => new Response());
    const adapter = new GitLabHttpAdapter({
      baseUrl: "https://127.0.0.1",
      token: "token",
      fetcher,
      egressPolicy: egressPolicy(),
    });

    await expect(adapter.getBranch("1", "main")).rejects.toMatchObject({
      code: "EGRESS_DENIED",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects Qdrant requests before fetch", async () => {
    const fetcher = vi.fn(async () => new Response());
    const store = new QdrantVectorStore({
      url: "https://metadata.google.internal",
      collection: "knowledge_chunks",
      fetcher,
      egressPolicy: egressPolicy(),
    });

    await expect(store.health()).rejects.toMatchObject({ code: "EGRESS_DENIED" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
