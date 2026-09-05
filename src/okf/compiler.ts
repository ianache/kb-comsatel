import { createHash } from "node:crypto";
import { okfDocumentSchema, type OkfDocument } from "./okf-schema.js";
import {
  readGitLabOkfFiles,
  readOkfFiles,
  type GitLabOkfSource,
} from "./corpus-reader.js";
import { validateGovernance } from "./governance.js";
import { toSourceDocument, type GovernanceIssue } from "./okf-types.js";
import type { SourceDocument } from "../retrieval/source-document.js";

export interface CompileOptions {
  mode: "draft" | "stable";
}

export type OkfCorpusSource = string | GitLabOkfSource;

export interface ProjectionDocument {
  knowledgeId: string;
  title: string;
  artifactType: string;
  sourceSystem: "okf";
  sourceUri: string;
  sourceRevision: string;
  product: string;
  domain: string;
  classification: string;
  status: SourceDocument["status"];
  successorKnowledgeId?: string;
  path: string;
  locator: SourceDocument["locator"];
  verifiedAt?: string;
  staleAfter?: string;
  acl: SourceDocument["acl"];
}

export interface ProjectionManifest {
  contractVersion: "okf-v0.2-i4a";
  corpusHash: string;
  documents: ProjectionDocument[];
  counts: {
    discovered: number;
    valid: number;
    indexable: number;
    errors: number;
  };
  errors: GovernanceIssue[];
  warnings: GovernanceIssue[];
}

export interface CompiledCorpus {
  manifest: ProjectionManifest;
  documents: readonly SourceDocument[];
  okfDocuments: readonly OkfDocument[];
  errors: readonly GovernanceIssue[];
  warnings: readonly GovernanceIssue[];
}

export async function compileOkfCorpus(
  input: OkfCorpusSource,
  _options: CompileOptions,
): Promise<CompiledCorpus> {
  const errors: GovernanceIssue[] = [];
  const warnings: GovernanceIssue[] = [];
  const rawFiles = [];
  try {
    rawFiles.push(
      ...(typeof input === "string"
        ? await readOkfFiles(input)
        : await readGitLabOkfFiles(input)),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to read OKF corpus";
    errors.push({
      code: "CORPUS_READ_FAILED",
      file: typeof input === "string" ? input : input.projectId,
      field: "",
      message,
    });
  }

  const documents: OkfDocument[] = [];
  for (const raw of rawFiles) {
    const parsed = okfDocumentSchema.safeParse({
      ...(isRecord(raw.frontmatter) ? raw.frontmatter : {}),
      file: raw.relativePath,
      ...(raw.sourceUri === undefined ? {} : { sourceUri: raw.sourceUri }),
      ...(raw.sourceRevision === undefined
        ? {}
        : { sourceRevision: raw.sourceRevision }),
      content: raw.content,
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push({
          code: "OKF_SCHEMA_INVALID",
          file: raw.relativePath,
          field: issue.path.join("."),
          message: issue.message,
        });
      }
      continue;
    }
    documents.push(parsed.data);
  }

  const ids = new Map<string, OkfDocument[]>();
  for (const document of documents) {
    const sameId = ids.get(document.knowledgeId) ?? [];
    sameId.push(document);
    ids.set(document.knowledgeId, sameId);
  }
  const corpusIds = new Set(ids.keys());
  for (const [knowledgeId, matches] of ids) {
    if (matches.length < 2) continue;
    for (const document of matches) {
      errors.push({
        code: "DUPLICATE_ID",
        file: document.file,
        field: "knowledgeId",
        message: `knowledgeId ${knowledgeId} is repeated`,
      });
    }
  }
  for (const document of documents) {
    errors.push(...validateGovernance(document, corpusIds));
    if (document.status !== "stable") {
      warnings.push({
        code: `${document.status.toUpperCase()}_NOT_INDEXED`,
        file: document.file,
        field: "status",
        message: `status ${document.status} is retained for review but is not indexed as stable`,
      });
    }
  }

  const sourceDocuments = documents.map(toSourceDocument);
  const indexable =
    errors.length === 0
      ? documents.filter((document) => document.status === "stable")
      : [];
  const projectionDocuments = indexable.map((document) =>
    toProjectionDocument(document),
  );
  const manifest: ProjectionManifest = {
    contractVersion: "okf-v0.2-i4a",
    corpusHash: hashCorpus(documents),
    documents: projectionDocuments,
    counts: {
      discovered: rawFiles.length,
      valid: documents.length,
      indexable: projectionDocuments.length,
      errors: errors.length,
    },
    errors: [...errors],
    warnings: [...warnings],
  };
  return {
    manifest,
    documents: sourceDocuments,
    okfDocuments: documents,
    errors,
    warnings,
  };
}

function toProjectionDocument(document: OkfDocument): ProjectionDocument {
  const source = toSourceDocument(document);
  return {
    knowledgeId: source.knowledgeId,
    title: source.title,
    artifactType: source.artifactType ?? "document",
    sourceSystem: "okf",
    sourceUri: source.sourceUri,
    sourceRevision: source.sourceRevision,
    product: source.product,
    domain: source.domain,
    classification: source.classification,
    status: source.status,
    ...(source.successorKnowledgeId === undefined
      ? {}
      : { successorKnowledgeId: source.successorKnowledgeId }),
    path: `documents/${encodeURIComponent(source.knowledgeId)}.md`,
    locator: source.locator,
    ...(source.verifiedAt === undefined
      ? {}
      : { verifiedAt: source.verifiedAt }),
    ...(source.staleAfter === undefined
      ? {}
      : { staleAfter: source.staleAfter }),
    acl: source.acl,
  };
}

function hashCorpus(documents: readonly OkfDocument[]): string {
  const canonical = documents
    .map((document) => ({ ...document }))
    .sort((left, right) => left.file.localeCompare(right.file))
    .map((document) => stableStringify(document))
    .join("\n");
  return createHash("sha256").update(canonical).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([left], [right]) => left.localeCompare(right),
    );
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
