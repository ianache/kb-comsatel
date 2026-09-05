import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { FilesystemDocumentSource } from "../../src/retrieval/filesystem-document-source.js";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true })),
  );
});

it("loads manifest metadata and content beneath the configured root", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kcp-i3-source-"));
  temporaryDirectories.push(directory);
  await writeFile(join(directory, "doc.md"), "# Hello\n\nContent");
  await writeFile(
    join(directory, "manifest.json"),
    JSON.stringify({
      documents: [
        {
          knowledgeId: "doc-1",
          title: "Document",
          artifactType: "rule",
          sourceSystem: "gitlab",
          sourceUri: "https://example.test/doc-1",
          sourceRevision: "rev-1",
          product: "cgo",
          domain: "units",
          classification: "internal",
          status: "stable",
          successorKnowledgeId: "replacement-rule",
          path: "doc.md",
          locator: { sectionPath: "intro" },
          acl: { groups: ["reviewers"], classifications: ["internal"] },
        },
      ],
    }),
  );

  const documents = [];
  for await (const document of new FilesystemDocumentSource({
    directory,
  }).list()) {
    documents.push(document);
  }

  expect(documents).toHaveLength(1);
  expect(documents[0]).toMatchObject({
    knowledgeId: "doc-1",
    content: "# Hello\n\nContent",
    acl: {
      groups: ["reviewers"],
      classifications: ["internal"],
      principalIds: [],
      roles: [],
      products: [],
      domains: [],
    },
  });
});

it("rejects a manifest path that escapes the source root", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kcp-i3-source-"));
  temporaryDirectories.push(directory);
  await writeFile(
    join(directory, "manifest.json"),
    JSON.stringify({
      documents: [
        {
          knowledgeId: "doc-1",
          title: "Document",
          sourceSystem: "gitlab",
          sourceUri: "https://example.test/doc-1",
          sourceRevision: "rev-1",
          product: "cgo",
          domain: "units",
          classification: "internal",
          status: "stable",
          path: "../outside.md",
          locator: {},
        },
      ],
    }),
  );

  const source = new FilesystemDocumentSource({ directory });
  await expect(source.list().next()).rejects.toThrow("escapes source root");
});
