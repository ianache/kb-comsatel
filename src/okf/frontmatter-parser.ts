import { parseDocument } from "yaml";

export interface ParsedOkfMarkdown {
  frontmatter: unknown;
  content: string;
}

export function parseOkfMarkdown(
  source: string,
  filename: string,
): ParsedOkfMarkdown {
  if (!source.startsWith("---\n") && !source.startsWith("---\r\n")) {
    throw new Error(`OKF frontmatter missing in ${filename}`);
  }

  const delimiter = source.match(/\r?\n---(?:\r?\n|$)/);
  if (delimiter === null || delimiter.index === undefined) {
    throw new Error(`OKF frontmatter is not closed in ${filename}`);
  }

  const yamlText = source.slice(4, delimiter.index);
  const content = source.slice(delimiter.index + delimiter[0].length);
  try {
    const document = parseDocument(yamlText, { prettyErrors: false });
    if (document.errors.length > 0) {
      throw new Error("invalid YAML");
    }
    return { frontmatter: document.toJS(), content };
  } catch {
    throw new Error(`Invalid OKF frontmatter in ${filename}`);
  }
}
