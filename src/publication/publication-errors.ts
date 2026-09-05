export const publicationErrorCodes = [
  "PUBLICATION_INVALID_CORPUS",
  "GITLAB_AUTH_REQUIRED",
  "GITLAB_FORBIDDEN",
  "GITLAB_PROJECT_NOT_ALLOWED",
  "BASE_BRANCH_CHANGED",
  "PUBLICATION_CONFLICT",
  "MR_ALREADY_OPEN",
  "APPROVAL_REQUIRED",
  "CI_NOT_GREEN",
  "GITLAB_UNAVAILABLE",
] as const;

export type PublicationErrorCode = (typeof publicationErrorCodes)[number];

export class PublicationError extends Error {
  constructor(
    readonly code: PublicationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PublicationError";
  }
}
