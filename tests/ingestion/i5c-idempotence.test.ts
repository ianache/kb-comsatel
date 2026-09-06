import { describe, expect, it, vi } from "vitest";
import { compileOkfCorpus } from "../../src/okf/compiler.js";
import { createGoogleDriveOkfSource } from "../../src/ingestion/google-drive-content.js";
import { FakeGoogleDriveSource } from "../../src/ingestion/fake-google-drive-source.js";
import {
  indexRemoteCorpus,
  type I5BIndexDependencies,
} from "../../src/ingestion/i5b-indexing.js";

const content = (text: string) => `---
knowledgeId: drive-rule-1
title: Drive rule
artifactType: rule
product: cgo
domain: operations
classification: internal
status: stable
owner: architecture
evidence: [https://example.test/evidence/drive-rule-1]
verifiedAt: 2026-09-01T00:00:00.000Z
staleAfter: 2030-01-01T00:00:00.000Z
acl:
  classifications: [internal]
relations: {}
---
${text}
`;

function source(body: string) {
  return createGoogleDriveOkfSource(
    new FakeGoogleDriveSource({
      files: [
        {
          fileId: "file-1",
          folderId: "folder-1",
          name: "rule.md",
          mimeType: "text/markdown",
          version: "7",
          content: body,
        },
      ],
    }),
    ["folder-1"],
  );
}

function dependencies() {
  const revisions: string[] = [];
  const deps: I5BIndexDependencies = {
    compile: (input, options) => compileOkfCorpus(input, options),
    write: async (corpus) => {
      revisions.push(corpus.okfDocuments[0]?.sourceRevision ?? "");
    },
    index: vi.fn(async () => ({
      processed: 1,
      skipped: 0,
      chunks: 1,
      vectors: 1,
      failed: 0,
    })),
  };
  return { deps, revisions };
}

describe("I5-C Drive identity", () => {
  it("changes source revision when content changes despite the same Drive version", async () => {
    const first = dependencies();
    const second = dependencies();
    const firstResult = await indexRemoteCorpus(
      {
        source: source(content("original")),
        outputDir: ".tmp/i5c-idempotence",
        mode: "stable",
      },
      first.deps,
    );
    const secondResult = await indexRemoteCorpus(
      {
        source: source(content("changed")),
        outputDir: ".tmp/i5c-idempotence",
        mode: "stable",
      },
      second.deps,
    );

    expect(firstResult.status).toBe("indexed");
    expect(secondResult.status).toBe("indexed");
    expect(first.revisions[0]).toMatch(/^7:[a-f0-9]{64}$/u);
    expect(second.revisions[0]).toMatch(/^7:[a-f0-9]{64}$/u);
    expect(second.revisions[0]).not.toBe(first.revisions[0]);
  });
});
