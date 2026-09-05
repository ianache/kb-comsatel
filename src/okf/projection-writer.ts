import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CompiledCorpus, ProjectionManifest } from "./compiler.js";

export async function writeProjection(
  corpus: CompiledCorpus,
  outputDir: string,
): Promise<ProjectionManifest> {
  if (corpus.errors.length > 0) {
    throw new Error("Cannot write invalid OKF corpus");
  }
  const parent = dirname(outputDir);
  await mkdir(parent, { recursive: true });
  const temporaryDir = join(
    parent,
    `.okf-projection-${process.pid}-${Date.now()}`,
  );
  await rm(temporaryDir, { recursive: true, force: true });
  try {
    await mkdir(join(temporaryDir, "documents"), { recursive: true });
    for (const document of corpus.okfDocuments.filter(
      (item) => item.status === "stable",
    )) {
      await writeFile(
        join(
          temporaryDir,
          "documents",
          `${encodeURIComponent(document.knowledgeId)}.md`,
        ),
        document.content,
        "utf8",
      );
    }
    await writeFile(
      join(temporaryDir, "manifest.json"),
      `${JSON.stringify(corpus.manifest, null, 2)}\n`,
      "utf8",
    );
    await rm(outputDir, { recursive: true, force: true });
    await rename(temporaryDir, outputDir);
    return corpus.manifest;
  } catch (error) {
    await rm(temporaryDir, { recursive: true, force: true });
    throw error;
  }
}
