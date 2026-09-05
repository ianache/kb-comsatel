import { describe, expect, it } from "vitest";
import { parseOkfMarkdown } from "../../src/okf/frontmatter-parser.js";

describe("parseOkfMarkdown", () => {
  it("separates YAML frontmatter from the Markdown body", () => {
    const parsed = parseOkfMarkdown(
      "---\nknowledgeId: rule-1\ntitle: Rule\n---\n# Rule\n",
      "rule.md",
    );

    expect(parsed.frontmatter).toMatchObject({ knowledgeId: "rule-1" });
    expect(parsed.content).toBe("# Rule\n");
  });

  it("rejects a document without frontmatter", () => {
    expect(() => parseOkfMarkdown("# Rule\n", "rule.md")).toThrow(
      "frontmatter",
    );
  });

  it("does not expose the Markdown body in malformed YAML errors", () => {
    expect(() =>
      parseOkfMarkdown(
        "---\nknowledgeId: [broken\n---\nsecret document body",
        "rule.md",
      ),
    ).toThrow("rule.md");
    expect(() =>
      parseOkfMarkdown(
        "---\nknowledgeId: [broken\n---\nsecret document body",
        "rule.md",
      ),
    ).not.toThrow("secret document body");
  });
});
