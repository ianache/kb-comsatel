import type {
  GitLabSourcePort,
  SourceFile,
  SourceTreeEntry,
} from "./source-port.js";
import { GitLabSourceError } from "./source-errors.js";

export interface FakeGitLabSourceFile {
  path: string;
  content: string;
}

export interface FakeGitLabSourceAdapterOptions {
  projectId: string;
  ref: string;
  revision: string;
  files: readonly FakeGitLabSourceFile[];
}

export class FakeGitLabSourceAdapter implements GitLabSourcePort {
  constructor(private readonly options: FakeGitLabSourceAdapterOptions) {}

  async resolveRevision(input: {
    projectId: string;
    ref: string;
  }): Promise<string> {
    this.assertProjectAndRef(input.projectId, input.ref);
    return this.options.revision;
  }

  async listTree(input: {
    projectId: string;
    ref: string;
    root?: string;
  }): Promise<readonly SourceTreeEntry[]> {
    this.assertProjectAndRef(input.projectId, input.ref);
    const root = normalizeRoot(input.root);
    return this.options.files
      .filter(
        (file) =>
          root.length === 0 ||
          file.path === root ||
          file.path.startsWith(`${root}/`),
      )
      .map((file) => ({ path: file.path, type: "blob" as const }));
  }

  async readFile(input: {
    projectId: string;
    ref: string;
    path: string;
  }): Promise<SourceFile> {
    this.assertProjectAndRef(input.projectId, input.ref);
    const file = this.options.files.find(
      (candidate) => candidate.path === input.path,
    );
    if (!file)
      throw new GitLabSourceError(
        "SOURCE_NOT_FOUND",
        "GitLab source file not found",
      );
    return {
      relativePath: file.path,
      content: file.content,
      sourceRevision: this.options.revision,
      sourceUri: sourceUri(input.projectId, input.ref, file.path),
    };
  }

  private assertProjectAndRef(projectId: string, ref: string): void {
    if (projectId !== this.options.projectId || ref !== this.options.ref)
      throw new GitLabSourceError(
        "SOURCE_NOT_FOUND",
        "GitLab source revision not found",
      );
  }
}

export function sourceUri(
  projectId: string,
  ref: string,
  path: string,
): string {
  return `gitlab://${encodeURIComponent(projectId)}/-/blob/${encodeURIComponent(ref)}/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

function normalizeRoot(root: string | undefined): string {
  return (root ?? "").replace(/^\/+|\/+$/gu, "");
}
