import { describe, expect, it } from "vitest";
import {
  createOtelProvider,
  type OtelProvider,
} from "../../src/ops/otel.js";
import { createStructuredLogger } from "../../src/ops/structured-logger.js";

describe("OpenTelemetry provider", () => {
  it("does not create an exporter or external work when disabled", async () => {
    const provider: OtelProvider = createOtelProvider({
      otelEnabled: false,
      otelServiceName: "test",
      otelEnvironment: "local",
    }, createStructuredLogger({ service: "test", environment: "test" }));

    expect(provider.enabled).toBe(false);
    provider.startSpan("mcp.search_knowledge", { operation: "search_knowledge" }).end();
    await expect(provider.shutdown()).resolves.toBeUndefined();
  });

  it("initializes an enabled provider with the configured endpoint", async () => {
    const provider = createOtelProvider({
      otelEnabled: true,
      otelEndpoint: "http://127.0.0.1:4318/v1/traces",
      otelServiceName: "test",
      otelEnvironment: "qa",
    }, createStructuredLogger({ service: "test", environment: "test" }));

    expect(provider.enabled).toBe(true);
    await expect(provider.shutdown()).resolves.toBeUndefined();
  });
});
