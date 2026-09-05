export type GoogleDriveSourceErrorCode =
  | "DRIVE_AUTH_REQUIRED"
  | "DRIVE_UNAVAILABLE"
  | "DRIVE_INVALID_RESPONSE"
  | "DRIVE_UNSUPPORTED_MIME"
  | "DRIVE_EXTRACTION_FAILED";

export class GoogleDriveSourceError extends Error {
  constructor(
    public readonly code: GoogleDriveSourceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GoogleDriveSourceError";
  }
}
