import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createSeedRepository } from "../catalog/seed.js";
import { MemoryAuditSink } from "../engine/audit.js";
import { ContextEngine } from "../engine/context-engine.js";
import { loadGoldenDataset } from "./golden-dataset.js";
import { GoldenEvaluationRunner } from "./golden-runner.js";
import {
  buildGoldenReport,
  renderGoldenJson,
  renderGoldenMarkdown,
} from "./golden-report.js";

const defaultDatasetPath = "tests/fixtures/golden/golden-cases.json";
const defaultOutputDirectory = ".tmp/i5d-golden-evaluation";

export async function runGoldenEvaluationCli(argv: readonly string[]): Promise<number> {
  if (argv[0] !== "eval" || argv.length > 3) {
    console.error('{"error":"Usage: eval [datasetPath] [outputDir]"}');
    return 2;
  }

  const datasetPath = argv[1] ?? defaultDatasetPath;
  const outputDirectory = resolve(argv[2] ?? defaultOutputDirectory);

  try {
    const dataset = await loadGoldenDataset(datasetPath);
    const engine = new ContextEngine(createSeedRepository(), new MemoryAuditSink());
    const results = await new GoldenEvaluationRunner(engine).run(dataset);
    const report = buildGoldenReport(results, {
      datasetVersion: dataset.version,
      datasetSize: dataset.cases.length,
      cases: dataset.cases,
    });

    await mkdir(outputDirectory, { recursive: true });
    await writeFile(`${outputDirectory}/report.json`, renderGoldenJson(report));
    await writeFile(
      `${outputDirectory}/report.md`,
      renderGoldenMarkdown(report),
    );
    console.log(
      JSON.stringify({
        datasetSize: report.datasetSize,
        executed: report.executed,
        passed: report.passed,
        failed: report.failed,
        complete: report.complete,
        outputDirectory,
      }),
    );
    return report.complete ? 0 : 1;
  } catch {
    console.error('{"error":"Golden evaluation unavailable"}');
    return 1;
  }
}

if (process.argv[1]?.endsWith("golden-cli.ts")) {
  const exitCode = await runGoldenEvaluationCli(process.argv.slice(2));
  process.exitCode = exitCode;
}
