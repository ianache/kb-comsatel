import { parseOkfMarkdown } from "../okf/frontmatter-parser.js";
import type { RawOkfFile } from "../okf/corpus-reader.js";
import type { SourceLocator } from "../retrieval/source-document.js";
import type {
  DriveFileMetadata,
  DriveSourceFile,
  GoogleDriveSourcePort,
} from "./google-drive-port.js";

export interface DriveContentExtractor {
  supports(metadata: DriveFileMetadata): boolean;
  extract(file: DriveSourceFile): Promise<{
    content: string;
    locator?: SourceLocator;
  }>;
}

export interface GoogleDriveOkfSource {
  kind: "google-drive";
  source: GoogleDriveSourcePort;
  folderIds: readonly string[];
  extractors: readonly DriveContentExtractor[];
}

export function createGoogleDriveOkfSource(
  source: GoogleDriveSourcePort,
  folderIds: readonly string[],
  extractors: readonly DriveContentExtractor[] = [],
): GoogleDriveOkfSource {
  return { kind: "google-drive", source, folderIds, extractors };
}

export async function readGoogleDriveOkfFiles(
  input: GoogleDriveOkfSource,
): Promise<RawOkfFile[]> {
  const metadata = await input.source.listFiles({ folderIds: input.folderIds });
  const result: RawOkfFile[] = [];
  for (const item of metadata) {
    const extractor = findExtractor(item, input.extractors);
    if (extractor === undefined) continue;
    const file = await input.source.readFile({
      fileId: item.fileId,
      metadata: item,
    });
    const extracted = await extractor.extract(file);
    const relativePath = `${item.folderId}/${item.name}`;
    const parsed = parseOkfMarkdown(extracted.content, relativePath);
    result.push({
      ...parsed,
      relativePath,
      source: extracted.content,
      sourceUri: file.sourceUri,
      sourceRevision: file.sourceRevision,
    });
  }
  return result.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
}

function findExtractor(
  metadata: DriveFileMetadata,
  extractors: readonly DriveContentExtractor[],
): DriveContentExtractor | undefined {
  const markdown = extractors.find((extractor) => extractor.supports(metadata));
  if (markdown !== undefined) return markdown;
  if (
    metadata.mimeType === "text/markdown" ||
    metadata.name.toLowerCase().endsWith(".md")
  ) {
    return {
      supports: () => true,
      extract: async (file) => ({
        content: new TextDecoder().decode(file.content),
      }),
    };
  }
  return undefined;
}
