import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseOkfArgs, runOkfCommand } from "../../src/ingestion/okf-cli.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("OKF CLI", () => {
  it("accepts positional source/output and explicit stable mode", () => {
    expect(
      parseOkfArgs(["compile", "fixtures/okf", "out", "--mode", "stable"]),
    ).toEqual({
      command: "compile",
      sourceDir: "fixtures/okf",
      outputDir: "out",
      mode: "stable",
      source: "local",
    });
  });

  it("accepts an explicit GitLab source", () => {
    expect(parseOkfArgs(["validate", "--source", "gitlab"])).toMatchObject({
      command: "validate",
      source: "gitlab",
      mode: "stable",
    });
  });

  it("returns a validation error without writing output", async () => {
    const parent = await mkdtemp(join(tmpdir(), "kcp-i4a-cli-"));
    directories.push(parent);
    const output = join(parent, "projection");

    await expect(
      runOkfCommand({}, [
        "validate",
        "tests/fixtures/okf-invalid",
        "--output-dir",
        output,
      ]),
    ).resolves.toBe(1);
    await expect(
      readFile(join(output, "manifest.json"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
