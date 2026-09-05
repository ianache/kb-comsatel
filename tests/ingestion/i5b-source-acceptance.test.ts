import { describe, expect, it, vi } from "vitest";
import { FakeGitLabSourceAdapter } from "../../src/ingestion/fake-gitlab-source-adapter.js";
import { compileOkfCorpus } from "../../src/okf/compiler.js";
import { indexGitLabCorpus } from "../../src/ingestion/i5b-indexing.js";
import type { I5BIndexDependencies } from "../../src/ingestion/i5b-indexing.js";

const stable = `---
knowledgeId: rule-1
title: Acceptance rule
artifactType: rule
product: cgo
domain: operations
classification: internal
status: stable
owner: architecture
evidence: [https://example.test/evidence/rule-1]
verifiedAt: 2026-09-01T00:00:00.000Z
staleAfter: 2030-01-01T00:00:00.000Z
acl:
  classifications: [internal]
relations: {}
---
Acceptance content.
`;

const draft = stable
  .replace("knowledgeId: rule-1", "knowledgeId: draft-1")
  .replace("status: stable", "status: draft");

function source(files: readonly { path: string; content: string }[]) {
  return {
    kind: "gitlab" as const,
    source: new FakeGitLabSourceAdapter({
      projectId: "587",
      ref: "main",
      revision: "commit-acceptance",
      files,
    }),
    projectId: "587",
    ref: "main",
    root: "knowledge",
  };
}

function dependencies() {
  const write = vi.fn(async () => undefined);
  const index = vi.fn(async () => ({
    processed: 1,
    skipped: 0,
    chunks: 1,
    vectors: 1,
    failed: 0,
  }));
  const deps: I5BIndexDependencies = {
    compile: (input, options) => compileOkfCorpus(input, options),
    write,
    index,
  };
  return { deps, write, index };
}

describe("I5-B GitLab source acceptance", () => {
  it("indexes stable documents and never mutates GitLab", async () => {
    const { deps, write, index } = dependencies();
    const result = await indexGitLabCorpus(
      {
        source: source([
          { path: "knowledge/rule-1.md", content: stable },
          { path: "knowledge/draft.md", content: draft },
        ]),
        outputDir: ".tmp/i5b-acceptance",
        mode: "stable",
      },
      deps,
    );

    expect(result).toMatchObject({
      status: "indexed",
      resolvedRevision: "commit-acceptance",
      counts: { discovered: 2, valid: 2, indexable: 1, errors: 0 },
    });
    expect(write).toHaveBeenCalledOnce();
    expect(index).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain("Acceptance content");
  });

  it("does not invoke I3 when the remote corpus is invalid", async () => {
    const { deps, write, index } = dependencies();
    const result = await indexGitLabCorpus(
      {
        source: source([{ path: "knowledge/bad.md", content: "not OKF" }]),
        outputDir: ".tmp/i5b-acceptance",
        mode: "stable",
      },
      deps,
    );

    expect(result.status).toBe("failed");
    expect(write).not.toHaveBeenCalled();
    expect(index).not.toHaveBeenCalled();
  });
});
