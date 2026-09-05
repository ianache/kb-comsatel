import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";
import {
  knowledgeStatusSchema,
  sourceSystemSchema,
} from "../domain/schemas.js";
import type { DocumentSource } from "./document-source.js";
import type { SourceDocument } from "./source-document.js";

const manifestEntrySchema = z
  .object({
    knowledgeId: z.string().trim().min(1),
    title: z.string().trim().min(1),
    sourceSystem: sourceSystemSchema,
    sourceUri: z.string().url(),
    sourceRevision: z.string().trim().min(1),
    product: z.string().trim().min(1),
    domain: z.string().trim().min(1),
    classification: z.string().trim().min(1),
    status: knowledgeStatusSchema,
    path: z.string().min(1),
    locator: z
      .object({
        sectionPath: z.string().optional(),
        pageRange: z.string().optional(),
        lineRange: z.string().optional(),
      })
      .strict()
      .default({}),
    verifiedAt: z.string().optional(),
    staleAfter: z.string().optional(),
    acl: z
      .object({
        principalIds: z.array(z.string()).default([]),
        roles: z.array(z.string()).default([]),
        groups: z.array(z.string()).default([]),
        products: z.array(z.string()).default([]),
        domains: z.array(z.string()).default([]),
        classifications: z.array(z.string()).default([]),
      })
      .strict()
      .default({
        principalIds: [],
        roles: [],
        groups: [],
        products: [],
        domains: [],
        classifications: [],
      }),
  })
  .strict();

const manifestSchema = z
  .object({ documents: z.array(manifestEntrySchema) })
  .strict();

export interface FilesystemDocumentSourceOptions {
  directory: string;
  manifestFile?: string;
}

export class FilesystemDocumentSource implements DocumentSource {
  private readonly directory: string;
  private readonly manifestFile: string;

  constructor(options: FilesystemDocumentSourceOptions) {
    this.directory = resolve(options.directory);
    this.manifestFile = options.manifestFile ?? "manifest.json";
  }

  async *list(): AsyncIterableIterator<SourceDocument> {
    const manifestPath = this.resolveInsideRoot(this.manifestFile);
    const manifest = manifestSchema.parse(
      JSON.parse(await readFile(manifestPath, "utf8")) as unknown,
    );
    for (const entry of manifest.documents) {
      const path = this.resolveInsideRoot(entry.path);
      yield {
        ...entry,
        content: await readFile(path, "utf8"),
      };
    }
  }

  private resolveInsideRoot(path: string): string {
    const resolved = resolve(this.directory, path);
    const relativePath = relative(this.directory, resolved);
    if (
      isAbsolute(relativePath) ||
      relativePath === ".." ||
      relativePath.startsWith("..")
    ) {
      throw new Error("Document path escapes source root");
    }
    return resolved;
  }
}
