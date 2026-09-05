import { expect, it } from "vitest";
import { canonicalizeDocument } from "../../src/retrieval/canonicalizer.js";
import { chunkDocument } from "../../src/retrieval/chunker.js";
import type { SourceDocument } from "../../src/retrieval/source-document.js";

const document: SourceDocument = {
  knowledgeId: "doc-1",
  title: "Document",
  sourceSystem: "gitlab",
  sourceUri: "https://example.test/doc-1",
  sourceRevision: "rev-1",
  product: "cgo",
  domain: "units",
  classification: "internal",
  status: "stable",
  content:
    "# Intro\n\nalpha beta gamma\n\n# Rules\n\ndelta epsilon zeta\n\n# Final\n\neta theta iota",
  locator: { sectionPath: "document" },
  acl: {
    principalIds: [],
    roles: [],
    groups: [],
    products: [],
    domains: [],
    classifications: [],
  },
};

it("creates bounded deterministic chunks with stable IDs and overlap", () => {
  const canonical = canonicalizeDocument(document);
  const options = { targetChars: 35, overlapChars: 8, maxChars: 45 };
  const first = chunkDocument(canonical, options);
  const second = chunkDocument(canonical, options);

  expect(first.length).toBeGreaterThan(1);
  expect(first).toEqual(second);
  expect(first.every((chunk) => chunk.text.length <= 45)).toBe(true);
  expect(first.every((chunk) => chunk.text.length > 0)).toBe(true);
  expect(first.map((chunk) => chunk.ordinal)).toEqual(
    first.map((_chunk, index) => index),
  );
});
