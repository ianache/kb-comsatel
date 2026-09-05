import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { parseOkfMarkdown } from "./frontmatter-parser.js";

export interface RawOkfFile {
  relativePath: string;
  source: string;
  frontmatter: unknown;
  content: string;
}

export async function readOkfFiles(inputDir: string): Promise<RawOkfFile[]> {
  const root = inputDir;
  const files: string[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        files.push(path);
      }
    }
  }

  await visit(root);
  const result: RawOkfFile[] = [];
  for (const path of files.sort((left, right) =>
    relative(root, left).localeCompare(relative(root, right)),
  )) {
    const source = await readFile(path, "utf8");
    const relativePath = relative(root, path).replaceAll("\\", "/");
    const parsed = parseOkfMarkdown(source, relativePath);
    result.push({ ...parsed, relativePath, source });
  }
  return result;
}
