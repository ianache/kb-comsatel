import { describe, expect, it, vi } from "vitest";
import { indexGitLabCorpus } from "../../src/ingestion/i5b-indexing.js";
import { FakeGitLabSourceAdapter } from "../../src/ingestion/fake-gitlab-source-adapter.js";
import type { CompiledCorpus } from "../../src/okf/compiler.js";
import type { IngestionSummary } from "../../src/retrieval/ingestion-indexer.js";

function source(content: string) {
  return {
    kind: "gitlab" as const,
    source: new FakeGitLabSourceAdapter({
      projectId: "587",
      ref: "main",
      revision: "commit-1",
      files: [{ path: "knowledge/rule.md", content }],
    }),
    projectId: "587",
    ref: "main",
    root: "knowledge",
  };
}

const stableMarkdown = `---
knowledgeId: rule-1
title: Stable remote rule
artifactType: rule
product: cgo
domain: operations
classification: internal
status: stable
owner: architecture
evidence: [https://example.test/evidence/rule-1]
verifiedAt: 2026-09-01T00:00:00.000Z
staleAfter: 2030-01-01T00:00:00.000Z
acl:
  classifications: [internal]
relations: {}
---
Stable content.
`;

const summary: IngestionSummary = {
  processed: 1,
  skipped: 0,
  chunks: 1,
  vectors: 1,
  failed: 0,
};

function dependencies() {
  const corpus = vi.fn(async () => {
    throw new Error("not configured");
  });
  const write = vi.fn(async () => undefined);
  const index = vi.fn(async () => summary);
  return { compile: corpus, write, index };
}

describe("I5-B GitLab indexing orchestrator", () => {
  it("compiles, writes and indexes a valid stable corpus in order", async () => {
    const deps = dependencies();
    deps.compile.mockImplementation(async (input) => {
      const { compileOkfCorpus } = await import("../../src/okf/compiler.js");
      return compileOkfCorpus(input, { mode: "stable" });
    });

    const result = await indexGitLabCorpus(
      {
        source: source(stableMarkdown),
        outputDir: ".tmp/i5b-test",
        mode: "stable",
      },
      deps,
    );

    expect(result).toMatchObject({
      projectId: "587",
      ref: "main",
      resolvedRevision: "commit-1",
      status: "indexed",
      corpusHash: expect.any(String),
      counts: { discovered: 1, valid: 1, indexable: 1, errors: 0 },
      indexed: 1,
      skipped: 0,
      chunks: 1,
      vectors: 1,
    });
    expect(deps.compile).toHaveBeenCalledOnce();
    expect(deps.write).toHaveBeenCalledOnce();
    expect(deps.index).toHaveBeenCalledOnce();
    expect(deps.compile.mock.invocationCallOrder[0]).toBeLessThan(
      deps.write.mock.invocationCallOrder[0]!,
    );
    expect(deps.write.mock.invocationCallOrder[0]).toBeLessThan(
      deps.index.mock.invocationCallOrder[0]!,
    );
  });

  it("does not write or index an invalid corpus", async () => {
    const deps = dependencies();
    deps.compile.mockResolvedValue({
      manifest: {
        contractVersion: "okf-v0.2-i4a",
        corpusHash: "hash-invalid",
        documents: [],
        counts: { discovered: 1, valid: 0, indexable: 0, errors: 1 },
        errors: [
          {
            code: "OKF_SCHEMA_INVALID",
            file: "rule.md",
            field: "title",
            message: "required",
          },
        ],
        warnings: [],
      },
      documents: [],
      okfDocuments: [],
      errors: [
        {
          code: "OKF_SCHEMA_INVALID",
          file: "rule.md",
          field: "title",
          message: "required",
        },
      ],
      warnings: [],
    } as CompiledCorpus);

    const result = await indexGitLabCorpus(
      { source: source("invalid"), outputDir: ".tmp/i5b-test", mode: "stable" },
      deps,
    );

    expect(result).toMatchObject({
      projectId: "587",
      resolvedRevision: "commit-1",
      status: "failed",
      counts: { errors: 1, indexable: 0 },
    });
    expect(deps.write).not.toHaveBeenCalled();
    expect(deps.index).not.toHaveBeenCalled();
  });
});
