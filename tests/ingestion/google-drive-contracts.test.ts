import { describe, expect, it } from "vitest";
import type {
  DriveFileMetadata,
  DriveSourceFile,
  GoogleDriveSourcePort,
} from "../../src/ingestion/google-drive-port.js";

describe("Google Drive source contracts", () => {
  it("models metadata without embedding file content in listings", async () => {
    const metadata: DriveFileMetadata = {
      fileId: "file-1",
      name: "rule.md",
      mimeType: "text/markdown",
      sizeBytes: 12,
      version: "7",
      modifiedTime: "2026-09-05T00:00:00.000Z",
      md5Checksum: "md5",
      webUrl: "https://drive.google.com/file/d/file-1/view",
      folderId: "folder-1",
      permissions: [{ id: "group-1", type: "group", role: "reader" }],
    };
    const sourceFile: DriveSourceFile = {
      metadata,
      content: new TextEncoder().encode("# rule"),
      sha256: "sha-256",
      sourceUri: metadata.webUrl!,
      sourceRevision: "7",
    };
    const source: GoogleDriveSourcePort = {
      listFiles: async () => [metadata],
      readFile: async () => sourceFile,
    };

    expect(sourceFile.metadata.fileId).toBe("file-1");
    expect(sourceFile.content).toBeInstanceOf(Uint8Array);
    expect(await source.listFiles({ folderIds: ["folder-1"] })).toEqual([
      metadata,
    ]);
  });
});
