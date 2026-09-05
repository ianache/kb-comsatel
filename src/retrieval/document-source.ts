import type { SourceDocument } from "./source-document.js";

export interface DocumentSource {
  list(): AsyncIterableIterator<SourceDocument>;
}
