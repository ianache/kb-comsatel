import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("I2 configuration", () => {
  it("loads disabled HTTP and external adapters by default", () => {
    expect(loadConfig({})).toMatchObject({
      host: "127.0.0.1",
      port: 8787,
      httpEnabled: false,
      httpLocalMode: false,
      mysqlEnabled: false,
      keycloakEnabled: false,
    });
  });

  it("rejects HTTP without a configured issuer unless local mode is enabled", () => {
    expect(() =>
      loadConfig({ KCP_HTTP_ENABLED: "true", KCP_HTTP_LOCAL_MODE: "false" }),
    ).toThrow("Keycloak issuer is required");
  });
});
