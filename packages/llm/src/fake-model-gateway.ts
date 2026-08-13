import type {
  ModelGateway,
  ModelRequest,
  ModelRun,
} from "./model-gateway.js";

export interface FakeModelSuccess {
  readonly outcome: "success";
  readonly run: ModelRun;
}

export type FakeModelStep = FakeModelSuccess;

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
      throw new Error("No scripted model run remains.");
    }

    return step.run;
  }
}
