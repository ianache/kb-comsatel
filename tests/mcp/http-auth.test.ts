import { describe, expect, it } from "vitest";
import { extractBearerToken } from "../../src/mcp/http-auth.js";

describe("HTTP bearer authentication", () => {
  it("extracts a bearer token case-insensitively", () => {
    expect(extractBearerToken("bearer opaque-token")).toBe("opaque-token");
  });

  it("rejects missing and malformed authorization", () => {
    expect(() => extractBearerToken(undefined)).toThrow(
      "Authentication required",
    );
    expect(() => extractBearerToken("Basic secret")).toThrow(
      "Invalid bearer token",
    );
  });
});
