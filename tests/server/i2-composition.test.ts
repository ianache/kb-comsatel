import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { createRuntimeDependencies } from "../../src/ops/runtime-dependencies.js";

describe("I2 runtime composition", () => {
  it("uses memory dependencies when MySQL is disabled", async () => {
    const config = loadConfig({});
    const dependencies = await createRuntimeDependencies(config);
    try {
      expect(dependencies.repository.constructor.name).toBe(
        "MemoryKnowledgeRepository",
      );
      expect(dependencies.principalResolver).toBeUndefined();
    } finally {
      await dependencies.close();
    }
  });
});
