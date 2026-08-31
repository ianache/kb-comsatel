import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("uses safe local defaults", () => {
    expect(loadConfig({})).toEqual({
      host: "127.0.0.1",
      port: 8787,
      logLevel: "info",
    });
  });

  it("rejects non-loopback hosts", () => {
    expect(() => loadConfig({ KCP_HOST: "0.0.0.0" })).toThrow(
      "Health server host must be a loopback address",
    );
  });
});
