export class SourceConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceConfigurationError";
  }
}

export type SourceErrorCode =
  | "SOURCE_AUTH_REQUIRED"
  | "SOURCE_UNAVAILABLE"
  | "SOURCE_INVALID_RESPONSE"
  | "SOURCE_NOT_FOUND";

export class GitLabSourceError extends Error {
  constructor(
    public readonly code: SourceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GitLabSourceError";
  }
}
