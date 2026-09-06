import { describe, expect, it, vi } from "vitest";
import {
  CircuitOpenError,
  OperationTimeoutError,
  createCircuitBreaker,
  createOperationDeadline,
} from "../../src/ops/resilience.js";

describe("operation deadlines", () => {
  it("aborts when the deadline expires and does not leak the timer", () => {
    vi.useFakeTimers();
    const deadline = createOperationDeadline(100);

    expect(deadline.remainingMs()).toBe(100);
    expect(deadline.signal().aborted).toBe(false);
    vi.advanceTimersByTime(100);
    expect(deadline.signal().aborted).toBe(true);
    expect(deadline.remainingMs()).toBe(0);
    vi.useRealTimers();
  });

  it("creates children that cannot exceed the parent deadline", () => {
    vi.useFakeTimers();
    const parent = createOperationDeadline(100);
    vi.advanceTimersByTime(40);
    const child = parent.child();

    expect(child.remainingMs()).toBe(60);
    vi.advanceTimersByTime(60);
    expect(parent.signal().aborted).toBe(true);
    expect(child.signal().aborted).toBe(true);
    vi.useRealTimers();
  });

  it("rejects invalid deadlines", () => {
    expect(() => createOperationDeadline(0)).toThrow(OperationTimeoutError);
  });
});

describe("circuit breaker", () => {
  it("opens after transport failures and fails fast", async () => {
    const breaker = createCircuitBreaker({
      failureThreshold: 2,
      openMs: 1000,
      halfOpenMaxCalls: 1,
    });
    const failure = new Error("network down");

    await expect(breaker.execute(async () => Promise.reject(failure))).rejects.toBe(
      failure,
    );
    await expect(breaker.execute(async () => Promise.reject(failure))).rejects.toBe(
      failure,
    );
    expect(breaker.state()).toBe("open");
    await expect(breaker.execute(async () => "unreachable")).rejects.toBeInstanceOf(
      CircuitOpenError,
    );
  });

  it("recovers through a successful half-open probe", async () => {
    vi.useFakeTimers();
    const breaker = createCircuitBreaker({
      failureThreshold: 1,
      openMs: 1000,
      halfOpenMaxCalls: 1,
    });

    await expect(breaker.execute(async () => Promise.reject(new Error("down")))).rejects
      .toThrow();
    vi.advanceTimersByTime(1000);
    expect(breaker.state()).toBe("half-open");
    await expect(breaker.execute(async () => "ok")).resolves.toBe("ok");
    expect(breaker.state()).toBe("closed");
    vi.useRealTimers();
  });

  it("supports excluding domain errors from failure counting", async () => {
    const breaker = createCircuitBreaker({
      failureThreshold: 1,
      openMs: 1000,
      halfOpenMaxCalls: 1,
      isFailure: () => false,
    });

    await expect(breaker.execute(async () => Promise.reject(new Error("404")))).rejects
      .toThrow("404");
    expect(breaker.state()).toBe("closed");
  });
});
