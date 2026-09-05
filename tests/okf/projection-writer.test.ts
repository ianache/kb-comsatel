import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FilesystemDocumentSource } from "../../src/retrieval/filesystem-document-source.js";
import { compileOkfCorpus } from "../../src/okf/compiler.js";
import { writeProjection } from "../../src/okf/projection-writer.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("writeProjection", () => {
  it("writes a manifest consumable by the I3 filesystem source", async () => {
    const output = await mkdtemp(join(tmpdir(), "kcp-i4a-projection-"));
    directories.push(output);
    const corpus = await compileOkfCorpus("tests/fixtures/okf-valid", {
      mode: "stable",
    });

    await writeProjection(corpus, output);
    const manifest = JSON.parse(
      await readFile(join(output, "manifest.json"), "utf8"),
    ) as {
      documents: Array<{ knowledgeId: string; path: string }>;
    };
    const documents = [];
    for await (const document of new FilesystemDocumentSource({
      directory: output,
    }).list()) {
      documents.push(document);
    }

    expect(manifest.documents).toHaveLength(1);
    expect(manifest.documents[0]?.path).toBe("documents/rule-1.md");
    expect(documents[0]).toMatchObject({
      knowledgeId: "rule-1",
      sourceSystem: "okf",
    });
    expect(documents[0]?.content).not.toContain("knowledgeId:");
  });

  it("does not create a projection for an invalid corpus", async () => {
    const parent = await mkdtemp(join(tmpdir(), "kcp-i4a-invalid-"));
    directories.push(parent);
    const output = join(parent, "projection");
    const corpus = await compileOkfCorpus("tests/fixtures/okf-invalid", {
      mode: "stable",
    });

    await expect(writeProjection(corpus, output)).rejects.toThrow(
      "invalid OKF corpus",
    );
    await expect(
      readFile(join(output, "manifest.json"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
