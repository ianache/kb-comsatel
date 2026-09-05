import { describe, expect, it } from "vitest";
import { GoogleDriveHttpAdapter } from "../../src/ingestion/google-drive-http-adapter.js";

describe("Google Drive sensitive output", () => {
  it("does not expose OAuth token or response body in normalized errors", async () => {
    const token = "oauth-secret-token";
    const adapter = new GoogleDriveHttpAdapter({
      baseUrl: "https://www.googleapis.com/drive/v3",
      token,
      fetcher: async () =>
        new Response(
          JSON.stringify({ error: token, document: "secret body" }),
          {
            status: 500,
          },
        ),
    });

    const error = await adapter
      .listFiles({ folderIds: ["folder-1"] })
      .catch((value: unknown) => value);
    expect(String(error)).not.toContain(token);
    expect(String(error)).not.toContain("secret body");
  });
});
