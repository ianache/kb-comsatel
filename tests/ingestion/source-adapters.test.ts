import { describe, expect, it } from "vitest";
import { GitLabHttpSourceAdapter } from "../../src/ingestion/gitlab-http-source-adapter.js";
import { FakeGitLabSourceAdapter } from "../../src/ingestion/fake-gitlab-source-adapter.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("FakeGitLabSourceAdapter", () => {
  it("resolves revisions, lists files and reads immutable source metadata", async () => {
    const source = new FakeGitLabSourceAdapter({
      projectId: "587",
      ref: "main",
      revision: "commit-1",
      files: [{ path: "knowledge/rule-1.md", content: "# Rule 1" }],
    });

    await expect(
      source.resolveRevision({ projectId: "587", ref: "main" }),
    ).resolves.toBe("commit-1");
    await expect(
      source.listTree({ projectId: "587", ref: "main", root: "knowledge" }),
    ).resolves.toEqual([{ path: "knowledge/rule-1.md", type: "blob" }]);
    await expect(
      source.readFile({
        projectId: "587",
        ref: "main",
        path: "knowledge/rule-1.md",
      }),
    ).resolves.toEqual({
      relativePath: "knowledge/rule-1.md",
      content: "# Rule 1",
      sourceRevision: "commit-1",
      sourceUri: "gitlab://587/-/blob/main/knowledge/rule-1.md",
    });
  });
});

describe("GitLabHttpSourceAdapter", () => {
  it("uses read-only GitLab REST endpoints and maps source files", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const adapter = new GitLabHttpSourceAdapter({
      baseUrl: "https://gitlab.example.test",
      token: "secret-token",
      fetcher: async (url, init) => {
        requests.push({ url: String(url), init });
        if (String(url).includes("/repository/commits/main"))
          return jsonResponse({ id: "commit-1", title: "main" });
        if (String(url).includes("/repository/tree"))
          return jsonResponse([{ path: "knowledge/rule-1.md", type: "blob" }]);
        if (String(url).includes("/repository/files/knowledge%2Frule-1.md/raw"))
          return new Response("# Rule 1", { status: 200 });
        return jsonResponse({ error: "unexpected request" }, 404);
      },
    });

    await expect(
      adapter.resolveRevision({ projectId: "587", ref: "main" }),
    ).resolves.toBe("commit-1");
    await expect(
      adapter.listTree({ projectId: "587", ref: "main", root: "knowledge" }),
    ).resolves.toEqual([{ path: "knowledge/rule-1.md", type: "blob" }]);
    await expect(
      adapter.readFile({
        projectId: "587",
        ref: "main",
        path: "knowledge/rule-1.md",
      }),
    ).resolves.toEqual({
      relativePath: "knowledge/rule-1.md",
      content: "# Rule 1",
      sourceRevision: "commit-1",
      sourceUri: "gitlab://587/-/blob/main/knowledge/rule-1.md",
    });

    expect(requests.every((request) => request.init?.method === "GET")).toBe(
      true,
    );
    expect(requests.every((request) => request.init?.headers).valueOf()).toBe(
      true,
    );
    expect(requests[0]?.init?.headers).toMatchObject({
      "PRIVATE-TOKEN": "secret-token",
    });
  });

  it("normalizes unavailable and invalid responses without leaking token or body", async () => {
    const adapter = new GitLabHttpSourceAdapter({
      baseUrl: "https://gitlab.example.test",
      token: "secret-token",
      fetcher: async () => jsonResponse({ error: "secret-token" }, 500),
    });

    await expect(
      adapter.resolveRevision({ projectId: "587", ref: "main" }),
    ).rejects.toMatchObject({
      code: "SOURCE_UNAVAILABLE",
      message: "GitLab source request failed (HTTP 500)",
    });
  });
});
