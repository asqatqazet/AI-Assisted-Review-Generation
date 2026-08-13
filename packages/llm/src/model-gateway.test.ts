import { describe, expect, it } from "vitest";

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
});
