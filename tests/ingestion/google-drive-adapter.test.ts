import { describe, expect, it } from "vitest";
import { FakeGoogleDriveSource } from "../../src/ingestion/fake-google-drive-source.js";
import { GoogleDriveHttpAdapter } from "../../src/ingestion/google-drive-http-adapter.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("FakeGoogleDriveSource", () => {
  it("returns deterministic metadata and content without network calls", async () => {
    const source = new FakeGoogleDriveSource({
      files: [
        {
          fileId: "file-1",
          folderId: "folder-1",
          name: "rule.md",
          mimeType: "text/markdown",
          version: "7",
          content: "# Rule",
        },
      ],
    });

    await expect(
      source.listFiles({ folderIds: ["folder-1"] }),
    ).resolves.toMatchObject([
      { fileId: "file-1", folderId: "folder-1", name: "rule.md" },
    ]);
    await expect(
      source.readFile({
        fileId: "file-1",
        metadata: (await source.listFiles({ folderIds: ["folder-1"] }))[0]!,
      }),
    ).resolves.toMatchObject({
      sourceRevision: "7",
      sha256: expect.any(String),
    });
  });
});

describe("GoogleDriveHttpAdapter", () => {
  it("paginates, filters and sorts metadata, then downloads content with OAuth", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const adapter = new GoogleDriveHttpAdapter({
      baseUrl: "https://www.googleapis.com/drive/v3",
      token: "oauth-token",
      fetcher: async (url, init) => {
        requests.push({ url: String(url), init });
        const parsed = new URL(String(url));
        if (parsed.pathname.endsWith("/files/file-1"))
          return new Response("# Rule", { status: 200 });
        if (parsed.searchParams.get("pageToken") === "next")
          return jsonResponse({
            files: [
              {
                id: "file-1",
                name: "a.md",
                mimeType: "text/markdown",
                version: "7",
                modifiedTime: "2026-09-05T00:00:00.000Z",
                webViewLink: "https://drive.google.com/file/d/file-1/view",
                parents: ["folder-1"],
                permissions: [],
              },
            ],
          });
        return jsonResponse({
          nextPageToken: "next",
          files: [
            {
              id: "file-2",
              name: "z.md",
              mimeType: "text/markdown",
              version: "8",
              parents: ["folder-2"],
              trashed: false,
              permissions: [],
            },
            {
              id: "deleted",
              name: "deleted.md",
              mimeType: "text/markdown",
              parents: ["folder-1"],
              trashed: true,
            },
          ],
        });
      },
    });

    const files = await adapter.listFiles({
      folderIds: ["folder-2", "folder-1"],
    });
    expect(files.map((file) => file.fileId)).toEqual(["file-1", "file-2"]);
    expect(new URL(requests[0]!.url).searchParams.get("q")).toContain(
      "folder-2",
    );
    expect(requests.every((request) => request.init?.method === "GET")).toBe(
      true,
    );
    expect(requests[0]?.init?.headers).toMatchObject({
      Authorization: "Bearer oauth-token",
    });

    const content = await adapter.readFile({
      fileId: "file-1",
      metadata: files[0]!,
    });
    expect(new TextDecoder().decode(content.content)).toBe("# Rule");
    expect(content.sha256).toBe(
      "1ca5f04e74783e4978c643ae9a87c41e1e5fd367c850be7c66bc104e6fd73177",
    );
  });

  it.each([401, 403, 404, 429, 500])(
    "normalizes HTTP %s without leaking response body",
    async (status) => {
      const adapter = new GoogleDriveHttpAdapter({
        baseUrl: "https://www.googleapis.com/drive/v3",
        token: "oauth-token",
        fetcher: async () => jsonResponse({ error: "oauth-token" }, status),
      });

      await expect(
        adapter.listFiles({ folderIds: ["folder-1"] }),
      ).rejects.toMatchObject({
        message: `Google Drive request failed (HTTP ${status})`,
      });
      await expect(
        adapter.listFiles({ folderIds: ["folder-1"] }),
      ).rejects.not.toThrow("oauth-token");
    },
  );
});
