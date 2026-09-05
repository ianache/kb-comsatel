import { describe, expect, it } from "vitest";
import { compileOkfCorpus } from "../../src/okf/compiler.js";

describe("compileOkfCorpus", () => {
  it("compiles the same corpus to the same hash and order", async () => {
    const first = await compileOkfCorpus("tests/fixtures/okf-valid", {
      mode: "stable",
    });
    const second = await compileOkfCorpus("tests/fixtures/okf-valid", {
      mode: "stable",
    });

    expect(second.manifest).toEqual(first.manifest);
    expect(second.manifest.corpusHash).toBe(first.manifest.corpusHash);
    expect(
      first.manifest.documents.map((document) => document.knowledgeId),
    ).toEqual(["rule-1"]);
  });

  it("reports duplicate IDs without returning a publishable corpus", async () => {
    const result = await compileOkfCorpus("tests/fixtures/okf-invalid", {
      mode: "stable",
    });

    expect(result.errors.map((issue) => issue.code)).toContain("DUPLICATE_ID");
    expect(result.manifest.documents).toEqual([]);
  });
});
