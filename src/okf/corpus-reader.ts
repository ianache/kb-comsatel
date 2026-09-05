import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { parseOkfMarkdown } from "./frontmatter-parser.js";
import type { GitLabSourcePort } from "../ingestion/source-port.js";

export interface RawOkfFile {
  relativePath: string;
  source: string;
  frontmatter: unknown;
  content: string;
  sourceUri?: string;
  sourceRevision?: string;
}

export interface GitLabOkfSource {
  kind: "gitlab";
  source: GitLabSourcePort;
  projectId: string;
  ref: string;
  root?: string;
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

export async function readGitLabOkfFiles(
  input: GitLabOkfSource,
): Promise<RawOkfFile[]> {
  const revision = await input.source.resolveRevision({
    projectId: input.projectId,
    ref: input.ref,
  });
  const entries = await input.source.listTree({
    projectId: input.projectId,
    ref: input.ref,
    root: input.root ?? "",
  });
  const files = entries
    .filter(
      (entry) =>
        entry.type === "blob" && entry.path.toLowerCase().endsWith(".md"),
    )
    .sort((left, right) => left.path.localeCompare(right.path));
  const result: RawOkfFile[] = [];
  for (const entry of files) {
    const file = await input.source.readFile({
      projectId: input.projectId,
      ref: input.ref,
      path: entry.path,
    });
    const parsed = parseOkfMarkdown(file.content, entry.path);
    result.push({
      ...parsed,
      relativePath: entry.path,
      source: file.content,
      sourceUri: file.sourceUri,
      sourceRevision: revision,
    });
  }
  return result;
}
