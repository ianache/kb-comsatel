import { expect, it } from "vitest";
import {
  resolveI3SourceDirectory,
  runI3Indexing,
} from "../../src/ingestion/i3-cli.js";

it("returns a nonzero status without starting infrastructure when I3 is disabled", async () => {
  await expect(runI3Indexing({}, [])).resolves.toBe(2);
});

it("accepts a positional source directory after npm strips the option flag", () => {
  expect(resolveI3SourceDirectory("./fixtures/i3", ["./custom-fixtures"])).toBe(
    "./custom-fixtures",
  );
  expect(
    resolveI3SourceDirectory("./fixtures/i3", [
      "--source-dir",
      "./custom-fixtures",
    ]),
  ).toBe("./custom-fixtures");
});
