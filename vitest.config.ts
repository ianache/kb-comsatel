import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // STDIO integration tests launch child processes and contend under the full suite.
    testTimeout: 30_000,
  },
});
