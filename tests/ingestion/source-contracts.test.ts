import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { SourceConfigurationError } from "../../src/ingestion/source-errors.js";
import type {
  SourceFile,
  SourceTreeEntry,
} from "../../src/ingestion/source-port.js";

describe("GitLab source contracts", () => {
  it("describes a source file without credentials or payload wrappers", () => {
    const file: SourceFile = {
      relativePath: "knowledge/rule.md",
      content: "document body",
      sourceUri:
        "https://project.example/project/-/blob/main/knowledge/rule.md",
      sourceRevision: "commit-1",
    };
    const tree: SourceTreeEntry = { path: file.relativePath, type: "blob" };

    expect(file).toEqual({
      relativePath: "knowledge/rule.md",
      content: "document body",
      sourceUri:
        "https://project.example/project/-/blob/main/knowledge/rule.md",
      sourceRevision: "commit-1",
    });
    expect(tree.type).toBe("blob");
    expect(JSON.stringify(file)).not.toContain("token");
  });

  it("disables GitLab source by default", () => {
    const config = loadConfig({});

    expect(config.gitlabSourceEnabled).toBe(false);
    expect(config.gitlabSourceBaseUrl).toBe("https://gitlab.example.com");
    expect(config.gitlabSourceRef).toBe("main");
    expect(config.gitlabSourceRoot).toBe("");
    expect(config.gitlabSourceTimeoutMs).toBe(10_000);
  });

  it("requires project and token when GitLab source is enabled", () => {
    expect(() => loadConfig({ KCP_GITLAB_SOURCE_ENABLED: "true" })).toThrow(
      SourceConfigurationError,
    );
    expect(() =>
      loadConfig({
        KCP_GITLAB_SOURCE_ENABLED: "true",
        KCP_GITLAB_SOURCE_PROJECT_ID: "857",
      }),
    ).toThrow("GitLab source token is required");
  });
});
