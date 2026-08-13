import { describe, expect, it, vi } from "vitest";

import {
  FakeModelGateway,
  ModelGatewayError,
  type ModelFailureCode,
  type ModelRequest,
  type ModelRun,
} from "@review/llm";

const request: ModelRequest = {
  model: "review-model-1",
  messages: [
    { role: "system", content: "Return a grounded review candidate." },
    { role: "user", content: "The staff were kind." },
  ],
  maxOutputTokens: 300,
  outputSchema: {
    name: "review_candidate",
    schema: { type: "object" },
  },
};

const firstRun: ModelRun = {
  output: {
    segments: [
      {
        kind: "claim",
        text: "The staff were kind.",
      },
    ],
  },
  attempt: {
    provider: "fake",
    model: "review-model-1",
    usage: {
      inputTokens: 19,
      outputTokens: 8,
    },
    receipt: {
      requestId: "fake-request-1",
      finishReason: "stop",
    },
  },
};

describe("FakeModelGateway", () => {
  it("returns one complete caller-scripted model run", async () => {
    const gateway = new FakeModelGateway([
      { outcome: "success", run: firstRun },
    ]);

    await expect(gateway.generate(request)).resolves.toEqual(firstRun);
  });

  it.each<ModelFailureCode>([
    "timeout",
    "rate-limit",
    "auth",
    "content-filter",
    "provider",
    "unavailable",
    "cancellation",
    "invalid-output",
  ])("reports a scripted %s failure without losing its type", async (code) => {
    const gateway = new FakeModelGateway([
      {
        outcome: "failure",
        failure: {
          code,
          message: `scripted ${code}`,
        },
      },
    ]);

    const error = await gateway.generate(request).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ModelGatewayError);
    expect(error).toMatchObject({ code, message: `scripted ${code}` });
  });

  it("reports provider unavailability after its script is exhausted", async () => {
    const gateway = new FakeModelGateway([
      { outcome: "success", run: firstRun },
    ]);
    await gateway.generate(request);

    const error = await gateway.generate(request).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ModelGatewayError);
    expect(error).toMatchObject({ code: "unavailable" });
  });

  it("does not settle a scripted run before its injected latency", async () => {
    vi.useFakeTimers();
    try {
      const gateway = new FakeModelGateway([
        { outcome: "success", run: firstRun, latencyMs: 50 },
      ]);
      let observed: ModelRun | undefined;
      const run = gateway.generate(request).then((value) => {
        observed = value;
      });

      await vi.advanceTimersByTimeAsync(49);
      expect(observed).toBeUndefined();

      await vi.advanceTimersByTimeAsync(1);
      await run;
      expect(observed).toEqual(firstRun);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a pre-aborted call without consuming a provider step", async () => {
    const controller = new AbortController();
    controller.abort();
    const gateway = new FakeModelGateway([
      { outcome: "success", run: firstRun },
    ]);

    const error = await gateway
      .generate(request, controller.signal)
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ModelGatewayError);
    expect(error).toMatchObject({ code: "cancellation" });
    await expect(gateway.generate(request)).resolves.toEqual(firstRun);
  });
});
