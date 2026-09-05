import { expect, it } from "vitest";
import { FakeGitLabAdapter } from "../../src/publication/fake-gitlab-adapter.js";

it("starts with a deterministic protected base branch", async () => {
  const adapter = new FakeGitLabAdapter();

  await expect(adapter.getBranch("project-1", "main")).resolves.toEqual({
    name: "main",
    sha: "base-sha-1",
  });
});
