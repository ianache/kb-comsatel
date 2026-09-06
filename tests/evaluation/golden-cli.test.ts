import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runGoldenEvaluationCli } from "../../src/evaluation/golden-cli.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "kcp-i5d-"));
  temporaryDirectories.push(path);
  return path;
}

describe("golden evaluation CLI", () => {
  it("runs the versioned dataset and writes aggregate reports", async () => {
    const outputDir = await temporaryDirectory();
    const exitCode = await runGoldenEvaluationCli([
      "eval",
      "tests/fixtures/golden/golden-cases.json",
      outputDir,
    ]);

    expect(exitCode).toBe(0);
    const report = JSON.parse(
      await readFile(join(outputDir, "report.json"), "utf8"),
    ) as { datasetSize: number; executed: number; complete: boolean };
    expect(report).toMatchObject({
      datasetSize: 30,
      executed: 30,
      complete: true,
    });
    expect(await readFile(join(outputDir, "report.md"), "utf8")).not.toMatch(
      /premium unit|excerpt|Authorization|Bearer|secret|token/i,
    );
  });

  it("returns one for an incomplete dataset", async () => {
    const directory = await temporaryDirectory();
    const dataset = JSON.parse(
      await readFile("tests/fixtures/golden/golden-cases.json", "utf8"),
    ) as { version: number; cases: unknown[] };
    const datasetPath = join(directory, "incomplete.json");
    await writeFile(
      datasetPath,
      JSON.stringify({ ...dataset, cases: dataset.cases.slice(0, 29) }),
    );

    const exitCode = await runGoldenEvaluationCli([
      "eval",
      datasetPath,
      join(directory, "out"),
    ]);

    expect(exitCode).toBe(1);
  });

  it("returns two for an invalid command", async () => {
    expect(await runGoldenEvaluationCli(["unknown-command"])).toBe(2);
  });
});
