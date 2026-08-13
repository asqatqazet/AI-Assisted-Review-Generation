import { CircuitBreaker, type CircuitBreakerOptions } from "./circuit-breaker.js";
import {
  ModelGatewayError,
  type ModelFailureCode,
  type ModelGateway,
  type ModelRequest,
  type ModelRun,
} from "./model-gateway.js";

export interface ResilientModelGatewayOptions {
  readonly primary: ModelGateway;
  readonly fallback?: ModelGateway;
  readonly maxRetries?: number;
  readonly baseRetryDelayMs?: number;
  readonly breakerOptions?: CircuitBreakerOptions;
}

const NON_RETRYABLE_CODES = new Set<ModelFailureCode>([
  "auth",
  "content-filter",
  "cancellation",
  "invalid-output",
]);

export class ResilientModelGateway implements ModelGateway {
  readonly #primary: ModelGateway;
  readonly #fallback: ModelGateway | undefined;
  readonly #maxRetries: number;
  readonly #baseRetryDelayMs: number;
  readonly #primaryBreaker: CircuitBreaker;
  readonly #fallbackBreaker: CircuitBreaker;

  public constructor(options: ResilientModelGatewayOptions) {
    this.#primary = options.primary;
    this.#fallback = options.fallback;
    this.#maxRetries = options.maxRetries ?? 2;
    this.#baseRetryDelayMs = options.baseRetryDelayMs ?? 100;
    this.#primaryBreaker = new CircuitBreaker(options.breakerOptions);
    this.#fallbackBreaker = new CircuitBreaker(options.breakerOptions);
  }

  public async generate(
    request: ModelRequest,
    signal?: AbortSignal,
  ): Promise<ModelRun> {
    if (signal?.aborted === true) {
      throw new ModelGatewayError(
        "cancellation",
        "Model generation was cancelled before it started.",
      );
    }

    try {
      return await this.#executeWithRetry(
        this.#primary,
        this.#primaryBreaker,
        request,
        signal,
      );
    } catch (primaryError) {
      if (
        primaryError instanceof ModelGatewayError &&
        NON_RETRYABLE_CODES.has(primaryError.code)
      ) {
        throw primaryError;
      }

      if (!this.#fallback) {
        throw primaryError;
      }

      // Failover to fallback gateway
      const fallbackRun = await this.#executeWithRetry(
        this.#fallback,
        this.#fallbackBreaker,
        request,
        signal,
      );

      return {
        ...fallbackRun,
        attempt: {
          ...fallbackRun.attempt,
          receipt: {
            ...fallbackRun.attempt.receipt,
            metadata: {
              ...fallbackRun.attempt.receipt.metadata,
              fallbackUsed: true,
              primaryFailureReason:
                primaryError instanceof Error ? primaryError.message : String(primaryError),
            },
          },
        },
      };
    }
  }

  async #executeWithRetry(
    gateway: ModelGateway,
    breaker: CircuitBreaker,
    request: ModelRequest,
    signal?: AbortSignal,
  ): Promise<ModelRun> {
    let attempts = 0;

    while (true) {
      attempts += 1;
      try {
        return await breaker.execute(() => gateway.generate(request, signal));
      } catch (error) {
        if (signal?.aborted === true) {
          throw new ModelGatewayError("cancellation", "Model generation was cancelled.");
        }

        if (
          error instanceof ModelGatewayError &&
          NON_RETRYABLE_CODES.has(error.code)
        ) {
          throw error;
        }

        if (attempts > this.#maxRetries) {
          throw error;
        }

        const delay =
          error instanceof ModelGatewayError && error.retryAfterMs
            ? error.retryAfterMs
            : this.#baseRetryDelayMs * Math.pow(2, attempts - 1) + Math.random() * 20;

        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
}
