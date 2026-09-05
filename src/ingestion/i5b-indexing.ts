import type { CompiledCorpus, OkfCorpusSource } from "../okf/compiler.js";
import type { IngestionSummary } from "../retrieval/ingestion-indexer.js";

export interface I5BIndexRequest {
  source: OkfCorpusSource;
  outputDir: string;
  mode: "stable";
}

export interface I5BIndexResult {
  projectId: string;
  ref: string;
  resolvedRevision: string;
  corpusHash: string;
  counts: CompiledCorpus["manifest"]["counts"];
  status: "indexed" | "skipped" | "failed";
  indexed: number;
  skipped: number;
  chunks: number;
  vectors: number;
}

export interface I5BIndexDependencies {
  compile(
    source: OkfCorpusSource,
    options: { mode: "stable" },
  ): Promise<CompiledCorpus>;
  write(corpus: CompiledCorpus, outputDir: string): Promise<void>;
  index(outputDir: string): Promise<IngestionSummary>;
}

export async function indexGitLabCorpus(
  request: I5BIndexRequest,
  dependencies: I5BIndexDependencies,
): Promise<I5BIndexResult> {
  const source = requireGitLabSource(request.source);
  const base = {
    projectId: source.projectId,
    ref: source.ref,
    resolvedRevision: "",
    corpusHash: "",
    counts: { discovered: 0, valid: 0, indexable: 0, errors: 0 },
  };

  try {
    const resolvedRevision = await source.source.resolveRevision({
      projectId: source.projectId,
      ref: source.ref,
    });
    const corpus = await dependencies.compile(request.source, {
      mode: request.mode,
    });
    const resultBase = {
      ...base,
      resolvedRevision,
      corpusHash: corpus.manifest.corpusHash,
      counts: corpus.manifest.counts,
    };
    if (corpus.errors.length > 0) {
      return {
        ...resultBase,
        status: "failed",
        indexed: 0,
        skipped: 0,
        chunks: 0,
        vectors: 0,
      };
    }
    if (corpus.manifest.counts.indexable === 0) {
      return {
        ...resultBase,
        status: "skipped",
        indexed: 0,
        skipped: 0,
        chunks: 0,
        vectors: 0,
      };
    }

    await dependencies.write(corpus, request.outputDir);
    const summary = await dependencies.index(request.outputDir);
    return {
      ...resultBase,
      status: summary.processed > 0 ? "indexed" : "skipped",
      indexed: summary.processed,
      skipped: summary.skipped,
      chunks: summary.chunks,
      vectors: summary.vectors,
    };
  } catch {
    return {
      ...base,
      status: "failed",
      indexed: 0,
      skipped: 0,
      chunks: 0,
      vectors: 0,
    };
  }
}

function requireGitLabSource(source: OkfCorpusSource) {
  if (typeof source === "string" || source.kind !== "gitlab") {
    throw new Error("I5-B requires a GitLab source");
  }
  return source;
}
