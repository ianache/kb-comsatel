import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("I5-E2 resilience configuration", () => {
  it("loads conservative defaults", () => {
    const config = loadConfig({});

    expect(config.operationTimeoutMs).toBe(10_000);
    expect(config.rateLimitCapacity).toBe(60);
    expect(config.rateLimitRefillPerSecond).toBe(1);
    expect(config.maxConcurrentRequests).toBe(16);
    expect(config.breakerFailureThreshold).toBe(3);
    expect(config.breakerOpenMs).toBe(30_000);
    expect(config.breakerHalfOpenMaxCalls).toBe(1);
  });

  it("parses resilience settings and hostname lists", () => {
    const config = loadConfig({
      KCP_OPERATION_TIMEOUT_MS: "5000",
      KCP_RATE_LIMIT_CAPACITY: "10",
      KCP_RATE_LIMIT_REFILL_PER_SECOND: "2",
      KCP_MAX_CONCURRENT_REQUESTS: "4",
      KCP_BREAKER_FAILURE_THRESHOLD: "5",
      KCP_BREAKER_OPEN_MS: "60000",
      KCP_BREAKER_HALF_OPEN_MAX_CALLS: "2",
      KCP_EGRESS_GITLAB_ALLOWED_HOSTS: "gitlab.example.com, gitlab.internal ",
    });

    expect(config).toMatchObject({
      operationTimeoutMs: 5000,
      rateLimitCapacity: 10,
      rateLimitRefillPerSecond: 2,
      maxConcurrentRequests: 4,
      breakerFailureThreshold: 5,
      breakerOpenMs: 60_000,
      breakerHalfOpenMaxCalls: 2,
      egressGitlabAllowedHosts: ["gitlab.example.com", "gitlab.internal"],
    });
  });

  it("rejects malformed resilience settings", () => {
    expect(() => loadConfig({ KCP_OPERATION_TIMEOUT_MS: "0" })).toThrow(
      "Invalid KCP_OPERATION_TIMEOUT_MS",
    );
    expect(() => loadConfig({ KCP_RATE_LIMIT_REFILL_PER_SECOND: "-1" })).toThrow(
      "Invalid KCP_RATE_LIMIT_REFILL_PER_SECOND",
    );
  });

  it("requires an allowlist for an enabled outbound dependency", () => {
    expect(() =>
      loadConfig({
        KCP_GITLAB_PUBLICATION_ENABLED: "true",
        KCP_GITLAB_PROJECT_ID: "587",
        KCP_GITLAB_TOKEN: "test-token",
      }),
    ).toThrow("GitLab egress allowlist is required");
  });
});
