export class OperationTimeoutError extends Error {
  readonly code = "OPERATION_TIMEOUT" as const;

  constructor() {
    super("Operation deadline exceeded");
  }
}

export class CircuitOpenError extends Error {
  readonly code = "CIRCUIT_OPEN" as const;

  constructor() {
    super("Dependency circuit is open");
  }
}

export class DependencyUnavailableError extends Error {
  readonly code = "DEPENDENCY_UNAVAILABLE" as const;

  constructor() {
    super("Dependency is unavailable");
  }
}

export interface OperationDeadline {
  readonly expiresAt: number;
  remainingMs(): number;
  signal(): AbortSignal;
  child(): OperationDeadline;
}

export function createOperationDeadline(
  timeoutMs: number,
  now: () => number = Date.now,
): OperationDeadline {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new OperationTimeoutError();
  }

  const expiresAt = now() + timeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  return {
    expiresAt,
    remainingMs: () => Math.max(0, expiresAt - now()),
    signal: () => controller.signal,
    child: () => {
      return createOperationDeadline(Math.max(1, expiresAt - now()), now);
    },
  };
}

export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreaker {
  execute<T>(operation: () => Promise<T>): Promise<T>;
  state(): CircuitState;
  reset(): void;
}

export interface CircuitBreakerOptions {
  failureThreshold: number;
  openMs: number;
  halfOpenMaxCalls: number;
  now?: () => number;
  isFailure?: (error: unknown) => boolean;
}

export function createCircuitBreaker({
  failureThreshold,
  openMs,
  halfOpenMaxCalls,
  now = Date.now,
  isFailure = () => true,
}: CircuitBreakerOptions): CircuitBreaker {
  if (
    !Number.isInteger(failureThreshold) ||
    failureThreshold <= 0 ||
    !Number.isInteger(openMs) ||
    openMs <= 0 ||
    !Number.isInteger(halfOpenMaxCalls) ||
    halfOpenMaxCalls <= 0
  ) {
    throw new Error("Invalid circuit breaker configuration");
  }

  let currentState: CircuitState = "closed";
  let failures = 0;
  let openedAt = 0;
  let halfOpenCalls = 0;

  function state(): CircuitState {
    if (currentState === "open" && now() - openedAt >= openMs) {
      currentState = "half-open";
      halfOpenCalls = 0;
    }
    return currentState;
  }

  function open(): void {
    currentState = "open";
    openedAt = now();
    halfOpenCalls = 0;
  }

  return {
    async execute<T>(operation: () => Promise<T>): Promise<T> {
      const current = state();
      if (current === "open") {
        throw new CircuitOpenError();
      }
      if (current === "half-open") {
        if (halfOpenCalls >= halfOpenMaxCalls) {
          throw new CircuitOpenError();
        }
        halfOpenCalls += 1;
      }

      try {
        const result = await operation();
        if (currentState === "half-open") {
          currentState = "closed";
          failures = 0;
          halfOpenCalls = 0;
        } else {
          failures = 0;
        }
        return result;
      } catch (error) {
        if (isFailure(error)) {
          if (currentState === "half-open" || ++failures >= failureThreshold) {
            open();
          }
        } else if (currentState === "half-open") {
          halfOpenCalls = Math.max(0, halfOpenCalls - 1);
        }
        throw error;
      }
    },
    state,
    reset: () => {
      currentState = "closed";
      failures = 0;
      openedAt = 0;
      halfOpenCalls = 0;
    },
  };
}
