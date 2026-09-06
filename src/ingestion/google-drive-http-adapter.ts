import { createHash } from "node:crypto";
import { GoogleDriveSourceError } from "./google-drive-errors.js";
import type {
  DriveFileMetadata,
  DrivePermission,
  DriveSourceFile,
  GoogleDriveSourcePort,
} from "./google-drive-port.js";
import type { CircuitBreaker, OperationDeadline } from "../ops/resilience.js";
import { createOperationDeadline } from "../ops/resilience.js";
import type { EgressPolicy } from "../security/egress-policy.js";

export type DriveFetcher = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface GoogleDriveHttpAdapterOptions {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
  fetcher?: DriveFetcher;
  egressPolicy?: EgressPolicy;
  breaker?: CircuitBreaker;
  deadline?: OperationDeadline;
}

export class GoogleDriveHttpAdapter implements GoogleDriveSourcePort {
  private readonly fetcher: DriveFetcher;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: GoogleDriveHttpAdapterOptions) {
    if (options.token.trim().length === 0) {
      throw new GoogleDriveSourceError(
        "DRIVE_AUTH_REQUIRED",
        "Google Drive token is required",
      );
    }
    this.fetcher = options.fetcher ?? globalThis.fetch;
    this.baseUrl = options.baseUrl.replace(/\/$/u, "");
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async listFiles(input: {
    folderIds: readonly string[];
  }): Promise<readonly DriveFileMetadata[]> {
    if (input.folderIds.length === 0) return [];
    const files: DriveFileMetadata[] = [];
    let pageToken: string | undefined;
    do {
      const query = new URLSearchParams({
        q: `(${input.folderIds.map((id) => `'${id}' in parents`).join(" or ")}) and trashed = false`,
        pageSize: "1000",
        fields:
          "nextPageToken,files(id,name,mimeType,size,version,modifiedTime,md5Checksum,webViewLink,parents,permissions(id,type,role))",
      });
      if (pageToken !== undefined) query.set("pageToken", pageToken);
      const body = await this.requestJson(
        `${this.baseUrl}/files?${query.toString()}`,
      );
      if (!isRecord(body) || !Array.isArray(body.files)) {
        throw new GoogleDriveSourceError(
          "DRIVE_INVALID_RESPONSE",
          "Google Drive returned an invalid file list",
        );
      }
      for (const item of body.files) {
        const metadata = mapMetadata(item, input.folderIds);
        if (metadata !== null) files.push(metadata);
      }
      pageToken =
        typeof body.nextPageToken === "string" ? body.nextPageToken : undefined;
    } while (pageToken !== undefined);

    return files.sort((left, right) =>
      `${left.folderId}/${left.name}/${left.fileId}`.localeCompare(
        `${right.folderId}/${right.name}/${right.fileId}`,
      ),
    );
  }

  async readFile(input: {
    fileId: string;
    metadata: DriveFileMetadata;
  }): Promise<DriveSourceFile> {
    const response = await this.requestResponse(
      `${this.baseUrl}/files/${encodeURIComponent(input.fileId)}?alt=media`,
    );
    const content = new Uint8Array(await response.arrayBuffer());
    const sha256 = createHash("sha256").update(content).digest("hex");
    return {
      metadata: input.metadata,
      content,
      sha256,
      sourceUri:
        input.metadata.webUrl ??
        `https://drive.google.com/file/d/${encodeURIComponent(input.fileId)}/view`,
      sourceRevision: `${revisionOf(input.metadata)}:${sha256}`,
    };
  }

  private async requestJson(url: string): Promise<unknown> {
    const response = await this.requestResponse(url);
    try {
      return await response.json();
    } catch {
      throw new GoogleDriveSourceError(
        "DRIVE_INVALID_RESPONSE",
        "Google Drive returned invalid JSON",
      );
    }
  }

  private async requestResponse(url: string): Promise<Response> {
    const requestUrl = this.options.egressPolicy
      ? await this.options.egressPolicy.validate(url, "drive")
      : url;
    const deadline = this.options.deadline?.child() ??
      createOperationDeadline(this.timeoutMs);
    try {
      const request = () =>
        this.fetcher(requestUrl, {
          method: "GET",
          headers: { Authorization: `Bearer ${this.options.token}` },
          signal: deadline.signal(),
        });
      const response = await (this.options.breaker
        ? this.options.breaker.execute(request)
        : request());
      if (!response.ok) {
        const code =
          response.status === 401 || response.status === 403
            ? "DRIVE_AUTH_REQUIRED"
            : "DRIVE_UNAVAILABLE";
        throw new GoogleDriveSourceError(
          code,
          `Google Drive request failed (HTTP ${response.status})`,
        );
      }
      return response;
    } catch (error) {
      if (error instanceof GoogleDriveSourceError) throw error;
      throw new GoogleDriveSourceError(
        "DRIVE_UNAVAILABLE",
        "Google Drive is unavailable",
      );
    } finally {
      // The deadline owns the abort timer and is bounded by the operation.
    }
  }
}

function mapMetadata(
  value: unknown,
  configuredFolders: readonly string[],
): DriveFileMetadata | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.mimeType !== "string"
  ) {
    throw new GoogleDriveSourceError(
      "DRIVE_INVALID_RESPONSE",
      "Google Drive returned invalid file metadata",
    );
  }
  if (value.trashed === true) return null;
  const parents = Array.isArray(value.parents)
    ? value.parents.filter(
        (parent): parent is string => typeof parent === "string",
      )
    : [];
  const folderId = parents.find((parent) => configuredFolders.includes(parent));
  if (folderId === undefined) return null;
  return {
    fileId: value.id,
    name: value.name,
    mimeType: value.mimeType,
    ...(typeof value.size === "string"
      ? { sizeBytes: Number(value.size) }
      : {}),
    ...(typeof value.version === "string" ? { version: value.version } : {}),
    ...(typeof value.modifiedTime === "string"
      ? { modifiedTime: value.modifiedTime }
      : {}),
    ...(typeof value.md5Checksum === "string"
      ? { md5Checksum: value.md5Checksum }
      : {}),
    ...(typeof value.webViewLink === "string"
      ? { webUrl: value.webViewLink }
      : {}),
    folderId,
    permissions: Array.isArray(value.permissions)
      ? value.permissions
          .filter(isPermission)
          .map((permission) => ({ ...permission }))
      : [],
  };
}

function revisionOf(metadata: DriveFileMetadata): string {
  if (metadata.version !== undefined) return metadata.version;
  return (
    [metadata.modifiedTime, metadata.md5Checksum].filter(Boolean).join(":") ||
    "unknown"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPermission(value: unknown): value is DrivePermission {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.type === "string" &&
    typeof value.role === "string"
  );
}
