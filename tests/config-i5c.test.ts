import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("Google Drive source configuration", () => {
  it("is disabled with safe defaults", () => {
    expect(loadConfig({})).toMatchObject({
      googleDriveSourceEnabled: false,
      googleDriveBaseUrl: "https://www.googleapis.com/drive/v3",
      googleDriveFolderIds: [],
      googleDriveTimeoutMs: 10_000,
    });
  });

  it("parses explicit folders and token when enabled", () => {
    expect(
      loadConfig({
        KCP_GOOGLE_DRIVE_SOURCE_ENABLED: "true",
        KCP_GOOGLE_DRIVE_FOLDER_IDS: "folder-1, folder-2",
        KCP_GOOGLE_DRIVE_TOKEN: "oauth-token",
        KCP_EGRESS_DRIVE_ALLOWED_HOSTS: "www.googleapis.com",
      }),
    ).toMatchObject({
      googleDriveSourceEnabled: true,
      googleDriveFolderIds: ["folder-1", "folder-2"],
      googleDriveToken: "oauth-token",
    });
  });

  it.each([
    [{ KCP_GOOGLE_DRIVE_SOURCE_ENABLED: "true" }, "folder IDs"],
    [
      {
        KCP_GOOGLE_DRIVE_SOURCE_ENABLED: "true",
        KCP_GOOGLE_DRIVE_FOLDER_IDS: "folder-1",
      },
      "token",
    ],
  ])("rejects enabled Drive without %s", (environment, message) => {
    expect(() => loadConfig(environment)).toThrow(message);
  });
});
