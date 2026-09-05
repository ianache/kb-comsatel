export class SecurityError extends Error {
  readonly code = "UNAUTHORIZED" as const;
  readonly statusCode = 401;

  constructor(message: "Authentication required" | "Invalid bearer token") {
    super(message);
    this.name = "SecurityError";
  }
}
