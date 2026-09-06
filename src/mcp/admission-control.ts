export interface AdmissionLease {
  release(): void;
}

export class AdmissionRejectedError extends Error {
  readonly code = "ADMISSION_REJECTED" as const;

  constructor(
    readonly statusCode: 429 | 503,
    readonly retryAfterSeconds: number,
    readonly reason: "rate_limit" | "concurrency",
  ) {
    super(
      reason === "rate_limit"
        ? "Request rate limit exceeded"
        : "Request concurrency limit exceeded",
    );
  }
}

export type AdmissionResult = AdmissionLease | AdmissionRejectedError;

export interface AdmissionControl {
  admit(identity: string): AdmissionResult;
  release(identity: string): void;
}

interface BucketState {
  tokens: number;
  lastRefillAt: number;
  inFlight: number;
}

export interface AdmissionControlOptions {
  capacity: number;
  refillPerSecond: number;
  maxConcurrent: number;
  now?: () => number;
  metrics?: MetricsRegistry;
}

export function createAdmissionControl({
  capacity,
  refillPerSecond,
  maxConcurrent,
  now = Date.now,
  metrics,
}: AdmissionControlOptions): AdmissionControl {
  if (
    !Number.isInteger(capacity) ||
    capacity <= 0 ||
    !Number.isInteger(refillPerSecond) ||
    refillPerSecond <= 0 ||
    !Number.isInteger(maxConcurrent) ||
    maxConcurrent <= 0
  ) {
    throw new Error("Invalid admission control configuration");
  }

  const buckets = new Map<string, BucketState>();
  let totalInFlight = 0;

  function recordInflight(): void {
    metrics?.set("kcp_http_inflight", { identity_class: "principal" }, totalInFlight);
  }

  function getBucket(identity: string): BucketState {
    const current = now();
    const existing = buckets.get(identity);
    if (existing) {
      const elapsedSeconds = Math.max(0, current - existing.lastRefillAt) / 1000;
      existing.tokens = Math.min(
        capacity,
        existing.tokens + elapsedSeconds * refillPerSecond,
      );
      existing.lastRefillAt = current;
      return existing;
    }
    const created = {
      tokens: capacity,
      lastRefillAt: current,
      inFlight: 0,
    };
    buckets.set(identity, created);
    if (buckets.size > 10_000) {
      for (const [key, bucket] of buckets) {
        if (bucket.inFlight === 0 && bucket.tokens >= capacity) {
          buckets.delete(key);
        }
        if (buckets.size <= 9_000) break;
      }
    }
    return created;
  }

  return {
    admit(identity: string): AdmissionResult {
      const bucket = getBucket(identity || "anonymous");
      if (bucket.inFlight >= maxConcurrent) {
        metrics?.increment("kcp_http_admission_total", {
          outcome: "rejected",
          reason: "concurrency",
        });
        return new AdmissionRejectedError(503, 1, "concurrency");
      }
      if (bucket.tokens < 1) {
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((1 - bucket.tokens) / refillPerSecond),
        );
        metrics?.increment("kcp_http_admission_total", {
          outcome: "rejected",
          reason: "rate_limit",
        });
        return new AdmissionRejectedError(
          429,
          retryAfterSeconds,
          "rate_limit",
        );
      }
      bucket.tokens -= 1;
      bucket.inFlight += 1;
      totalInFlight += 1;
      metrics?.increment("kcp_http_admission_total", {
        outcome: "accepted",
        reason: "none",
      });
      recordInflight();
      let released = false;
      return {
        release: () => {
          if (released) return;
          released = true;
          bucket.inFlight = Math.max(0, bucket.inFlight - 1);
          totalInFlight = Math.max(0, totalInFlight - 1);
          recordInflight();
        },
      };
    },
    release(identity: string): void {
      const bucket = buckets.get(identity || "anonymous");
      if (bucket) {
        bucket.inFlight = Math.max(0, bucket.inFlight - 1);
        totalInFlight = Math.max(0, totalInFlight - 1);
        recordInflight();
      }
    },
  };
}
import type { MetricsRegistry } from "../ops/metrics-registry.js";
