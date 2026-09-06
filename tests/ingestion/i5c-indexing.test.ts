import { describe, expect, it, vi } from "vitest";
import { compileOkfCorpus } from "../../src/okf/compiler.js";
import { createGoogleDriveOkfSource } from "../../src/ingestion/google-drive-content.js";
import { FakeGoogleDriveSource } from "../../src/ingestion/fake-google-drive-source.js";
import {
  indexRemoteCorpus,
  type I5BIndexDependencies,
} from "../../src/ingestion/i5b-indexing.js";

const stable = `---
knowledgeId: drive-rule-1
title: Drive stable rule
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
Drive stable content.
`;

const draft = stable
  .replace("knowledgeId: drive-rule-1", "knowledgeId: drive-draft-1")
  .replace("status: stable", "status: draft");

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
    compile: (source, options) => compileOkfCorpus(source, options),
    write,
    index,
  };
  return { deps, write, index };
}

describe("I5-C Drive indexing", () => {
  it("indexes stable Drive content and preserves source identity", async () => {
    const source = createGoogleDriveOkfSource(
      new FakeGoogleDriveSource({
        files: [
          {
            fileId: "file-stable",
            folderId: "folder-1",
            name: "stable.md",
            mimeType: "text/markdown",
            version: "7",
            content: stable,
          },
          {
            fileId: "file-draft",
            folderId: "folder-1",
            name: "draft.md",
            mimeType: "text/markdown",
            version: "8",
            content: draft,
          },
        ],
      }),
      ["folder-1"],
    );
    const { deps, write, index } = dependencies();

    const result = await indexRemoteCorpus(
      { source, outputDir: ".tmp/i5c-indexing", mode: "stable" },
      deps,
    );

    expect(result).toMatchObject({
      sourceSystem: "google-drive",
      sourceId: "folder-1",
      ref: "drive",
      status: "indexed",
      counts: { discovered: 2, valid: 2, indexable: 1, errors: 0 },
    });
    expect(result.resolvedRevision).toMatch(/^[a-f0-9]{64}$/u);
    expect(write).toHaveBeenCalledOnce();
    expect(index).toHaveBeenCalledOnce();
  });
});
