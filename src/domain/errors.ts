export type KcpErrorCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "INSUFFICIENT_EVIDENCE"
  | "INTERNAL_ERROR";

export interface KcpErrorPayload {
  code: KcpErrorCode;
  message: string;
  correlationId?: string;
}

export class KcpError extends Error {
  readonly code: KcpErrorCode;
  readonly correlationId?: string;

  constructor(code: KcpErrorCode, message: string, correlationId?: string) {
    super(message);
    this.name = "KcpError";
    this.code = code;
    this.correlationId = correlationId;
  }

  toMcpError(): KcpErrorPayload {
    return {
      code: this.code,
      message: this.message,
      ...(this.correlationId === undefined
        ? {}
        : { correlationId: this.correlationId }),
    };
  }

  toJSON(): KcpErrorPayload {
    return this.toMcpError();
  }
}
