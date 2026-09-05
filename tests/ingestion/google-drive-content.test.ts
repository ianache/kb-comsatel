import { describe, expect, it } from "vitest";
import { FakeGoogleDriveSource } from "../../src/ingestion/fake-google-drive-source.js";
import {
  createGoogleDriveOkfSource,
  readGoogleDriveOkfFiles,
} from "../../src/ingestion/google-drive-content.js";

const okf = `---
knowledgeId: rule-1
title: Drive rule
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
Drive content.
`;

describe("Google Drive content normalization", () => {
  it("reads Markdown and preserves Drive provenance", async () => {
    const source = createGoogleDriveOkfSource(
      new FakeGoogleDriveSource({
        files: [
          {
            fileId: "file-1",
            folderId: "folder-1",
            name: "rule.md",
            mimeType: "text/markdown",
            version: "7",
            content: okf,
          },
        ],
      }),
      ["folder-1"],
    );

    await expect(readGoogleDriveOkfFiles(source)).resolves.toMatchObject([
      {
        relativePath: "folder-1/rule.md",
        sourceUri: "https://drive.google.com/file/d/file-1/view",
        sourceRevision: "7",
        content: "Drive content.\n",
      },
    ]);
  });

  it("uses an injected PDF extractor and skips unsupported PDF safely", async () => {
    const source = createGoogleDriveOkfSource(
      new FakeGoogleDriveSource({
        files: [
          {
            fileId: "pdf-1",
            folderId: "folder-1",
            name: "rule.pdf",
            mimeType: "application/pdf",
            version: "3",
            content: "binary-pdf",
          },
        ],
      }),
      ["folder-1"],
      [
        {
          supports: (metadata) => metadata.mimeType === "application/pdf",
          extract: async () => ({ content: okf }),
        },
      ],
    );
    await expect(readGoogleDriveOkfFiles(source)).resolves.toHaveLength(1);

    const withoutExtractor = createGoogleDriveOkfSource(
      new FakeGoogleDriveSource({
        files: [
          {
            fileId: "pdf-2",
            folderId: "folder-1",
            name: "unsupported.pdf",
            mimeType: "application/pdf",
            content: "binary-pdf",
          },
        ],
      }),
      ["folder-1"],
    );
    await expect(readGoogleDriveOkfFiles(withoutExtractor)).resolves.toEqual(
      [],
    );
  });
});
