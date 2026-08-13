import type {
  ModelAttempt,
  ModelFailureCode,
  ModelGateway,
  ModelRequest,
  ModelRun,
} from "./model-gateway.js";
import { ModelGatewayError } from "./model-gateway.js";

export interface FakeModelSuccess {
  readonly outcome: "success";
  readonly run: ModelRun;
  readonly latencyMs?: number;
}

export interface FakeModelFailure {
  readonly outcome: "failure";
  readonly latencyMs?: number;
  readonly failure: {
    readonly code: ModelFailureCode;
    readonly message: string;
    readonly retryAfterMs?: number;
    readonly attempt?: ModelAttempt;
  };
}

export type FakeModelStep = FakeModelFailure | FakeModelSuccess;

function cancelled(message: string): ModelGatewayError {
  return new ModelGatewayError("cancellation", message);
}

function waitForLatency(
  latencyMs: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (latencyMs <= 0) {
    return Promise.resolve();
  }
  if (signal?.aborted === true) {
    return Promise.reject(
      cancelled("Model generation was cancelled before it started."),
    );
  }

  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(cancelled("Model generation was cancelled."));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, latencyMs);

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export class FakeModelGateway implements ModelGateway {
  readonly #steps: readonly FakeModelStep[];
  #nextStep = 0;

  public constructor(steps: readonly FakeModelStep[]) {
    this.#steps = [...steps];
  }

  public async generate(
    _request: ModelRequest,
    signal?: AbortSignal,
  ): Promise<ModelRun> {
    if (signal?.aborted === true) {
      throw cancelled("Model generation was cancelled before it started.");
    }

    const step = this.#steps[this.#nextStep];
    this.#nextStep += 1;

    if (step === undefined) {
      throw new ModelGatewayError(
        "unavailable",
        "No scripted model run remains.",
      );
    }

    await waitForLatency(step.latencyMs ?? 0, signal);

    if (step.outcome === "failure") {
      throw new ModelGatewayError(
        step.failure.code,
        step.failure.message,
        step.failure,
      );
    }

    return step.run;
  }
}
