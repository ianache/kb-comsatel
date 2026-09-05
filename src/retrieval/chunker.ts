import { createHash } from "node:crypto";
import type { CanonicalDocument, DocumentChunk } from "./source-document.js";

export interface ChunkOptions {
  targetChars: number;
  overlapChars: number;
  maxChars: number;
}

export function chunkDocument(
  document: CanonicalDocument,
  options: ChunkOptions,
): DocumentChunk[] {
  if (
    options.targetChars < 1 ||
    options.maxChars < options.targetChars ||
    options.overlapChars >= options.targetChars
  ) {
    throw new Error("Invalid chunk options");
  }

  const paragraphs = document.content
    .split(/\n{2,}/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (paragraph.length > options.maxChars) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      for (let offset = 0; offset < paragraph.length;) {
        const end = Math.min(offset + options.maxChars, paragraph.length);
        chunks.push(paragraph.slice(offset, end));
        if (end === paragraph.length) break;
        offset = end - options.overlapChars;
      }
      continue;
    }

    const candidate =
      current.length === 0 ? paragraph : `${current}\n\n${paragraph}`;
    if (candidate.length <= options.targetChars) {
      current = candidate;
      continue;
    }
    if (current) chunks.push(current);
    const overlap = current.slice(
      Math.max(0, current.length - options.overlapChars),
    );
    current = overlap.length > 0 ? `${overlap}\n\n${paragraph}` : paragraph;
    if (current.length > options.maxChars) {
      chunks.push(current.slice(0, options.maxChars));
      current = current.slice(
        Math.max(0, options.maxChars - options.overlapChars),
      );
    }
  }
  if (current) chunks.push(current);

  return chunks.map((text, ordinal) => ({
    chunkId: createHash("sha256")
      .update(`${document.knowledgeId}|${document.sourceRevision}|${ordinal}`)
      .digest("hex")
      .slice(0, 32),
    knowledgeId: document.knowledgeId,
    sourceRevision: document.sourceRevision,
    ordinal,
    text,
    contentHash: document.contentHash,
    characterCount: text.length,
    tokenEstimate: Math.ceil(text.length / 4),
    locator: document.locator,
  }));
}
