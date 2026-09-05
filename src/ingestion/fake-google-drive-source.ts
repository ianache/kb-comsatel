import { createHash } from "node:crypto";
import { GoogleDriveSourceError } from "./google-drive-errors.js";
import type {
  DriveFileMetadata,
  DriveSourceFile,
  GoogleDriveSourcePort,
} from "./google-drive-port.js";

export interface FakeGoogleDriveFile {
  fileId: string;
  folderId: string;
  name: string;
  mimeType: string;
  content: string;
  version?: string;
}

export class FakeGoogleDriveSource implements GoogleDriveSourcePort {
  constructor(
    private readonly files: { files: readonly FakeGoogleDriveFile[] },
  ) {}

  async listFiles(input: {
    folderIds: readonly string[];
  }): Promise<readonly DriveFileMetadata[]> {
    const folders = new Set(input.folderIds);
    return this.files.files
      .filter((file) => folders.has(file.folderId))
      .map((file) => metadata(file))
      .sort((left, right) =>
        `${left.folderId}/${left.name}/${left.fileId}`.localeCompare(
          `${right.folderId}/${right.name}/${right.fileId}`,
        ),
      );
  }

  async readFile(input: {
    fileId: string;
    metadata: DriveFileMetadata;
  }): Promise<DriveSourceFile> {
    const file = this.files.files.find(
      (candidate) => candidate.fileId === input.fileId,
    );
    if (file === undefined) {
      throw new GoogleDriveSourceError(
        "DRIVE_INVALID_RESPONSE",
        "Google Drive file not found",
      );
    }
    const content = new TextEncoder().encode(file.content);
    return {
      metadata: input.metadata,
      content,
      sha256: sha256(content),
      sourceUri:
        input.metadata.webUrl ??
        `https://drive.google.com/file/d/${file.fileId}/view`,
      sourceRevision: `${file.version ?? "unknown"}:${sha256(content)}`,
    };
  }
}

function metadata(file: FakeGoogleDriveFile): DriveFileMetadata {
  return {
    fileId: file.fileId,
    name: file.name,
    mimeType: file.mimeType,
    sizeBytes: new TextEncoder().encode(file.content).byteLength,
    version: file.version,
    webUrl: `https://drive.google.com/file/d/${file.fileId}/view`,
    folderId: file.folderId,
    permissions: [],
  };
}

function sha256(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}
