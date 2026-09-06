import { SecurityError } from "../security/security-errors.js";
import { AdmissionRejectedError } from "./admission-control.js";
import { EgressDeniedError } from "../security/egress-policy.js";
import {
  CircuitOpenError,
  DependencyUnavailableError,
  OperationTimeoutError,
} from "../ops/resilience.js";

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
  if (error instanceof AdmissionRejectedError) {
    return {
      statusCode: error.statusCode,
      body: {
        error: {
          code: error.statusCode === 429 ? "RATE_LIMITED" : "CONCURRENCY_LIMITED",
          message: error.message,
        },
      },
    };
  }
  if (error instanceof EgressDeniedError) {
    return {
      statusCode: 403,
      body: { error: { code: "EGRESS_DENIED", message: "Outbound request denied" } },
    };
  }
  if (error instanceof OperationTimeoutError) {
    return {
      statusCode: 504,
      body: { error: { code: "DEADLINE_EXCEEDED", message: "Operation timed out" } },
    };
  }
  if (error instanceof CircuitOpenError || error instanceof DependencyUnavailableError) {
    return {
      statusCode: 503,
      body: { error: { code: "DEPENDENCY_UNAVAILABLE", message: "Dependency unavailable" } },
    };
  }
  return {
    statusCode: 500,
    body: { error: { code: "INTERNAL_ERROR", message: "Internal HTTP error" } },
  };
}
