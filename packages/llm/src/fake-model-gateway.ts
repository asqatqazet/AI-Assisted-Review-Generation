import type {
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
  };
}

export type FakeModelStep = FakeModelFailure | FakeModelSuccess;

export class FakeModelGateway implements ModelGateway {
  readonly #steps: readonly FakeModelStep[];
  #nextStep = 0;

  public constructor(steps: readonly FakeModelStep[]) {
    this.#steps = [...steps];
  }

  public async generate(
    _request: ModelRequest,
    _signal?: AbortSignal,
  ): Promise<ModelRun> {
    const step = this.#steps[this.#nextStep];
    this.#nextStep += 1;

    if (step === undefined) {
      throw new ModelGatewayError(
        "unavailable",
        "No scripted model run remains.",
      );
    }

    if ((step.latencyMs ?? 0) > 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, step.latencyMs);
      });
    }

    if (step.outcome === "failure") {
      throw new ModelGatewayError(step.failure.code, step.failure.message);
    }

    return step.run;
  }
}
