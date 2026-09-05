import { expect, it } from "vitest";
import { runI3Indexing } from "../../src/ingestion/i3-cli.js";

it("returns a nonzero status without starting infrastructure when I3 is disabled", async () => {
  await expect(runI3Indexing({}, [])).resolves.toBe(2);
});
