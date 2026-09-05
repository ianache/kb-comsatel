import { expect, it } from "vitest";
import { GitLabHttpAdapter } from "../../src/publication/gitlab-http-adapter.js";

it("does not expose the GitLab token in normalized errors", async () => {
  const adapter = new GitLabHttpAdapter({
    baseUrl: "https://gitlab.example.test",
    token: "secret-token",
    fetcher: async () => {
      throw new Error("request failed with secret-token");
    },
  });

  const error = await adapter
    .getBranch("project-1", "main")
    .catch((value: unknown) => value);
  expect(error).toMatchObject({ code: "GITLAB_UNAVAILABLE" });
  expect(JSON.stringify(error)).not.toContain("secret-token");
});
