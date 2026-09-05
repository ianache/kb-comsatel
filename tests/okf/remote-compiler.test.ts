import { describe, expect, it } from "vitest";
import { FakeGitLabSourceAdapter } from "../../src/ingestion/fake-gitlab-source-adapter.js";
import { compileOkfCorpus } from "../../src/okf/compiler.js";

describe("compileOkfCorpus with a GitLab source", () => {
  it("reads markdown from the source port and injects immutable provenance", async () => {
    const source = new FakeGitLabSourceAdapter({
      projectId: "587",
      ref: "main",
      revision: "commit-1",
      files: [
        {
          path: "knowledge/rule-1.md",
          content: `---
knowledgeId: rule-1
title: Remote rule
artifactType: rule
product: cgo
domain: operations
classification: internal
status: stable
owner: analyst
evidence: [https://example.test/evidence/rule-1]
verifiedAt: 2026-09-01T00:00:00.000Z
staleAfter: 2030-01-01T00:00:00.000Z
acl:
  classifications: [internal]
relations: {}
---
# Remote rule
`,
        },
      ],
    });

    const result = await compileOkfCorpus(
      {
        kind: "gitlab",
        source,
        projectId: "587",
        ref: "main",
        root: "knowledge",
      },
      { mode: "stable" },
    );

    expect(result.errors).toEqual([]);
    expect(result.okfDocuments[0]).toMatchObject({
      file: "knowledge/rule-1.md",
      sourceUri: "gitlab://587/-/blob/main/knowledge/rule-1.md",
      sourceRevision: "commit-1",
    });
    expect(result.manifest.documents[0]?.knowledgeId).toBe("rule-1");
  });
});
