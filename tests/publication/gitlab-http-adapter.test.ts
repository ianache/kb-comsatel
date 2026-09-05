import { describe, expect, it } from "vitest";
import { GitLabHttpAdapter } from "../../src/publication/gitlab-http-adapter.js";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("GitLabHttpAdapter", () => {
  it("maps branch, commit and merge request operations to GitLab REST", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const adapter = new GitLabHttpAdapter({
      baseUrl: "https://gitlab.example.test",
      token: "secret-token",
      fetcher: async (url, init) => {
        requests.push({ url: String(url), init });
        if (String(url).includes("/branches/main"))
          return response({ name: "main", commit: { id: "base-1" } });
        if (String(url).includes("/merge_requests?")) return response([]);
        if (String(url).includes("/repository/branches"))
          return response({ name: "feature", commit: { id: "base-1" } });
        if (String(url).includes("/repository/commits"))
          return response({
            id: "commit-1",
            web_url: "https://gitlab.example.test/commit-1",
          });
        return response({
          iid: 1,
          web_url: "https://gitlab.example.test/mr/1",
          source_branch: "feature",
          target_branch: "main",
          state: "opened",
          description: "proposal",
        });
      },
    });

    await expect(adapter.getBranch("project-1", "main")).resolves.toEqual({
      name: "main",
      sha: "base-1",
    });
    await expect(
      adapter.createBranch({
        projectId: "project-1",
        branch: "feature",
        ref: "base-1",
      }),
    ).resolves.toMatchObject({ name: "feature" });
    const branchRequest = requests.find((request) =>
      request.url.endsWith("/repository/branches?branch=feature&ref=base-1"),
    );
    expect(branchRequest).toBeDefined();
    expect(branchRequest?.init?.body).toBeUndefined();
    await expect(
      adapter.createCommit({
        projectId: "project-1",
        branch: "feature",
        commitMessage: "commit",
        files: [{ path: "knowledge/rule.md", content: "body" }],
      }),
    ).resolves.toMatchObject({ id: "commit-1" });
    await expect(
      adapter.createMergeRequest({
        projectId: "project-1",
        sourceBranch: "feature",
        targetBranch: "main",
        title: "title",
        description: "description",
        labels: ["okf"],
        reviewerIds: ["1"],
      }),
    ).resolves.toMatchObject({ iid: 1 });

    expect(requests[0]?.init?.headers).toMatchObject({
      "PRIVATE-TOKEN": "secret-token",
    });
    expect(JSON.stringify(requests)).toContain("knowledge/rule.md");
  });

  it("returns null for a missing branch", async () => {
    const adapter = new GitLabHttpAdapter({
      baseUrl: "https://gitlab.example.test",
      token: "secret-token",
      fetcher: async () => response({ message: "404 Branch Not Found" }, 404),
    });

    await expect(adapter.getBranch("project-1", "missing")).resolves.toBeNull();
  });

  it.each([
    [401, "GITLAB_AUTH_REQUIRED"],
    [403, "GITLAB_FORBIDDEN"],
    [429, "GITLAB_UNAVAILABLE"],
    [500, "GITLAB_UNAVAILABLE"],
  ] as const)("normalizes HTTP %s to %s", async (status, code) => {
    const adapter = new GitLabHttpAdapter({
      baseUrl: "https://gitlab.example.test",
      token: "secret-token",
      fetcher: async () => response({ error: "secret-token" }, status),
    });

    await expect(adapter.getBranch("project-1", "main")).rejects.toMatchObject({
      code,
    });
  });
});
