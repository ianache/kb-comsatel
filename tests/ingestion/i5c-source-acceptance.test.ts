import { describe, expect, it, vi } from "vitest";
import { compileOkfCorpus } from "../../src/okf/compiler.js";
import { createGoogleDriveOkfSource } from "../../src/ingestion/google-drive-content.js";
import { FakeGoogleDriveSource } from "../../src/ingestion/fake-google-drive-source.js";
import {
  indexRemoteCorpus,
  type I5BIndexDependencies,
} from "../../src/ingestion/i5b-indexing.js";

const markdown = `---
knowledgeId: drive-acceptance-1
title: Drive acceptance rule
artifactType: rule
product: cgo
domain: operations
classification: internal
status: stable
owner: architecture
evidence: [https://example.test/evidence/drive-acceptance-1]
verifiedAt: 2026-09-01T00:00:00.000Z
staleAfter: 2030-01-01T00:00:00.000Z
acl:
  classifications: [internal]
relations: {}
---
Drive acceptance content.
`;

describe("I5-C Drive source acceptance", () => {
  it("indexes Markdown, skips unsupported PDF, and never exposes content in result", async () => {
    const source = createGoogleDriveOkfSource(
      new FakeGoogleDriveSource({
        files: [
          {
            fileId: "md-1",
            folderId: "folder-1",
            name: "rule.md",
            mimeType: "text/markdown",
            version: "1",
            content: markdown,
          },
          {
            fileId: "pdf-1",
            folderId: "folder-1",
            name: "manual.pdf",
            mimeType: "application/pdf",
            version: "2",
            content: "binary PDF body",
          },
        ],
      }),
      ["folder-1"],
    );
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

    const result = await indexRemoteCorpus(
      { source, outputDir: ".tmp/i5c-acceptance", mode: "stable" },
      deps,
    );

    expect(result).toMatchObject({
      sourceSystem: "google-drive",
      status: "indexed",
      counts: { discovered: 1, valid: 1, indexable: 1, errors: 0 },
    });
    expect(JSON.stringify(result)).not.toContain("Drive acceptance content");
    expect(JSON.stringify(result)).not.toContain("binary PDF body");
    expect(write).toHaveBeenCalledOnce();
    expect(index).toHaveBeenCalledOnce();
  });
});
