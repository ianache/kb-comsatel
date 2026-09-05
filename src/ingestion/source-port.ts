export interface SourceFile {
  relativePath: string;
  content: string;
  sourceUri: string;
  sourceRevision: string;
}

export interface SourceTreeEntry {
  path: string;
  type: "blob" | "tree";
}

export interface GitLabSourcePort {
  resolveRevision(input: { projectId: string; ref: string }): Promise<string>;
  listTree(input: {
    projectId: string;
    ref: string;
    root: string;
  }): Promise<readonly SourceTreeEntry[]>;
  readFile(input: {
    projectId: string;
    ref: string;
    path: string;
  }): Promise<SourceFile>;
}
