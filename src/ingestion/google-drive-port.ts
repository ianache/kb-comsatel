export interface DrivePermission {
  id: string;
  type: string;
  role: string;
}

export interface DriveFileMetadata {
  fileId: string;
  name: string;
  mimeType: string;
  sizeBytes?: number;
  version?: string;
  modifiedTime?: string;
  md5Checksum?: string;
  webUrl?: string;
  folderId: string;
  permissions: readonly DrivePermission[];
}

export interface DriveSourceFile {
  metadata: DriveFileMetadata;
  content: Uint8Array;
  sha256: string;
  sourceUri: string;
  sourceRevision: string;
}

export interface GoogleDriveSourcePort {
  listFiles(input: {
    folderIds: readonly string[];
  }): Promise<readonly DriveFileMetadata[]>;
  readFile(input: {
    fileId: string;
    metadata: DriveFileMetadata;
  }): Promise<DriveSourceFile>;
}
