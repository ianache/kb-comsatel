import { expect, it } from "vitest";
import { canonicalizeDocument } from "../../src/retrieval/canonicalizer.js";
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
  content: "  Héllo\r\n\r\n\r\n world  \r\n",
  locator: { sectionPath: "intro", lineRange: "1-4" },
  acl: {
    principalIds: [],
    roles: [],
    groups: [],
    products: [],
    domains: [],
    classifications: ["internal"],
  },
};

it("canonicalizes whitespace and produces a stable content hash", () => {
  const first = canonicalizeDocument(document);
  const second = canonicalizeDocument({
    ...document,
    content: "Héllo\n\nworld",
  });

  expect(first.content).toBe("Héllo\n\nworld");
  expect(first.contentHash).toBe(second.contentHash);
  expect(first.locator).toEqual(document.locator);
});
