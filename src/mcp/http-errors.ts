import { SecurityError } from "../security/security-errors.js";

export function httpErrorResponse(error: unknown): {
  statusCode: number;
  body: { error: { code: string; message: string } };
} {
  if (error instanceof SecurityError) {
    return {
      statusCode: error.statusCode,
      body: { error: { code: error.code, message: error.message } },
    };
  }
  return {
    statusCode: 500,
    body: { error: { code: "INTERNAL_ERROR", message: "Internal HTTP error" } },
  };
}
