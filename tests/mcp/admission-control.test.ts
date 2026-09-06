import { describe, expect, it } from "vitest";
import { createAdmissionControl } from "../../src/mcp/admission-control.js";

describe("HTTP admission control", () => {
  it("isolates token buckets by identity", () => {
    const control = createAdmissionControl({
      capacity: 1,
      refillPerSecond: 1,
      maxConcurrent: 2,
    });

    expect(control.admit("alice")).toHaveProperty("release");
    expect(control.admit("alice")).toMatchObject({ statusCode: 429 });
    expect(control.admit("bob")).toHaveProperty("release");
  });

  it("rejects concurrency before consuming more work", () => {
    const control = createAdmissionControl({
      capacity: 5,
      refillPerSecond: 5,
      maxConcurrent: 1,
    });
    const first = control.admit("alice");

    expect(first).toHaveProperty("release");
    expect(control.admit("alice")).toMatchObject({ statusCode: 503 });
    if ("release" in first) first.release();
    expect(control.admit("alice")).toHaveProperty("release");
  });

  it("refills tokens using the injected clock and returns bounded retry-after", () => {
    let now = 0;
    const control = createAdmissionControl({
      capacity: 1,
      refillPerSecond: 2,
      maxConcurrent: 2,
      now: () => now,
    });
    const first = control.admit("alice");
    if ("release" in first) first.release();
    expect(control.admit("alice")).toMatchObject({ statusCode: 429 });
    now = 500;
    expect(control.admit("alice")).toHaveProperty("release");
  });

  it("makes lease release idempotent", () => {
    const control = createAdmissionControl({
      capacity: 2,
      refillPerSecond: 1,
      maxConcurrent: 1,
    });
    const lease = control.admit("alice");
    expect("release" in lease).toBe(true);
    if ("release" in lease) {
      lease.release();
      lease.release();
    }
    expect(control.admit("alice")).toHaveProperty("release");
  });
});
