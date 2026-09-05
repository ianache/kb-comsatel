import { createHash } from "node:crypto";
import type { CanonicalDocument, SourceDocument } from "./source-document.js";

export function canonicalizeDocument(
  document: SourceDocument,
): CanonicalDocument {
  const content = document.content
    .normalize("NFKC")
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  const contentHash = createHash("sha256")
    .update(content, "utf8")
    .digest("hex");
  return { ...document, content, contentHash };
}
