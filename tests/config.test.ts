import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("uses safe local defaults", () => {
    expect(loadConfig({})).toMatchObject({
      host: "127.0.0.1",
      port: 8787,
      logLevel: "info",
      otelEnabled: false,
      otelServiceName: "knowledge-context-mcp",
      otelEnvironment: "local",
    });
  });

  it("parses explicit OpenTelemetry configuration", () => {
    expect(
      loadConfig({
        KCP_OTEL_ENABLED: "true",
        KCP_OTEL_ENDPOINT: "http://127.0.0.1:4318/v1/traces",
        KCP_OTEL_SERVICE_NAME: "kcp-test",
        KCP_OTEL_ENVIRONMENT: "qa",
      }),
    ).toMatchObject({
      otelEnabled: true,
      otelEndpoint: "http://127.0.0.1:4318/v1/traces",
      otelServiceName: "kcp-test",
      otelEnvironment: "qa",
    });
  });

  it("rejects an invalid OpenTelemetry endpoint", () => {
    expect(() =>
      loadConfig({ KCP_OTEL_ENDPOINT: "not-a-url" }),
    ).toThrow("Invalid KCP_OTEL_ENDPOINT");
  });

  it("rejects non-loopback hosts", () => {
    expect(() => loadConfig({ KCP_HOST: "0.0.0.0" })).toThrow(
      "Health server host must be a loopback address",
    );
  });
});
