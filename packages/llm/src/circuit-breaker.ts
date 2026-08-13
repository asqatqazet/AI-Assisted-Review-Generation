export type CircuitBreakerState = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  readonly failureThreshold?: number;
  readonly resetTimeoutMs?: number;
}

export class CircuitBreaker {
  readonly #failureThreshold: number;
  readonly #resetTimeoutMs: number;

  #state: CircuitBreakerState = "closed";
  #consecutiveFailures = 0;
  #lastFailureTime = 0;

  public constructor(options: CircuitBreakerOptions = {}) {
    this.#failureThreshold = options.failureThreshold ?? 3;
    this.#resetTimeoutMs = options.resetTimeoutMs ?? 10_000;
  }

  public get state(): CircuitBreakerState {
    if (this.#state === "open") {
      const now = Date.now();
      if (now - this.#lastFailureTime >= this.#resetTimeoutMs) {
        this.#state = "half-open";
      }
    }
    return this.#state;
  }

  public async execute<Result>(fn: () => Promise<Result>): Promise<Result> {
    const currentState = this.state;

    if (currentState === "open") {
      throw new Error("Circuit breaker is open. Requests are temporarily rejected.");
    }

    try {
      const result = await fn();
      this.#onSuccess();
      return result;
    } catch (error) {
      this.#onFailure();
      throw error;
    }
  }

  #onSuccess(): void {
    this.#consecutiveFailures = 0;
    this.#state = "closed";
  }

  #onFailure(): void {
    this.#consecutiveFailures += 1;
    this.#lastFailureTime = Date.now();

    if (this.#consecutiveFailures >= this.#failureThreshold) {
      this.#state = "open";
    }
  }
}
