import { describe, expect, it } from "vitest";
import { httpErrorResponse } from "../../src/mcp/http-errors.js";
import { toSafeError } from "../../src/mcp/tools.js";

describe("safe error boundaries", () => {
  it("does not serialize secrets from unexpected failures", () => {
    const secret = "eyJhbGciOiJIUzI1NiJ9.secret.signature";
    const serialized = JSON.stringify(
      toSafeError("search_knowledge", new Error(secret)),
    );
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("SQL");
  });

  it("uses a fixed HTTP internal error response", () => {
    expect(httpErrorResponse(new Error("database password"))).toEqual({
      statusCode: 500,
      body: {
        error: { code: "INTERNAL_ERROR", message: "Internal HTTP error" },
      },
    });
  });
});
