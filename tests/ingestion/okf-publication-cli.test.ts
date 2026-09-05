import { describe, expect, it } from "vitest";
import {
  parsePublicationArgs,
  runPublicationCommand,
} from "../../src/ingestion/okf-publication-cli.js";

describe("OKF publication CLI", () => {
  it("accepts positional mode values forwarded by npm", () => {
    expect(
      parsePublicationArgs(["publish", "tests/fixtures/okf-valid", "proposal"]),
    ).toMatchObject({
      command: "publish",
      sourceDir: "tests/fixtures/okf-valid",
      mode: "proposal",
    });
  });

  it("prints a safe deterministic plan without enabling GitLab", async () => {
    const output: string[] = [];
    const originalLog = console.log;
    console.log = (...values: unknown[]) => output.push(values.join(" "));
    try {
      const exitCode = await runPublicationCommand({}, [
        "plan",
        "tests/fixtures/okf-valid",
      ]);
      expect(exitCode).toBe(0);
    } finally {
      console.log = originalLog;
    }
    expect(output.join("\n")).toContain("knowledge/");
    expect(output.join("\n")).not.toContain("Verified unit identifiers");
  });

  it("does not publish when GitLab is not explicitly enabled", async () => {
    const errors: string[] = [];
    const originalError = console.error;
    console.error = (...values: unknown[]) => errors.push(values.join(" "));
    try {
      const exitCode = await runPublicationCommand({}, [
        "publish",
        "tests/fixtures/okf-valid",
        "proposal",
      ]);
      expect(exitCode).toBe(2);
    } finally {
      console.error = originalError;
    }
    expect(errors.join("\n")).toContain("GitLab publication is disabled");
    expect(errors.join("\n")).not.toContain("token");
  });
});
