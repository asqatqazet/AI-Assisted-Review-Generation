import { describe, expect, it } from "vitest";

import { CircuitBreaker } from "./circuit-breaker.js";
import { FakeModelGateway } from "./fake-model-gateway.js";
import {
  type ModelGatewayError,
  type ModelRequest,
  type ModelRun,
} from "./model-gateway.js";
import { ResilientModelGateway } from "./resilient-gateway.js";

const sampleRequest: ModelRequest = {
  model: "claude-sonnet",
  messages: [{ role: "user", content: "Hello" }],
  maxOutputTokens: 200,
  outputSchema: {
    name: "test",
    schema: {},
  },
};

const sampleSuccessRun: ModelRun = {
  output: { draft: "Clean visit." },
  attempt: {
    provider: "fake",
    model: "claude-sonnet",
    usage: { inputTokens: 10, outputTokens: 5 },
    receipt: { requestId: "req-1", finishReason: "stop" },
  },
};

describe("TS-13 CircuitBreaker", () => {
  it("starts in closed state and remains closed on success", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 100 });
    expect(breaker.state).toBe("closed");

    const result = await breaker.execute(() => Promise.resolve("ok"));
    expect(result).toBe("ok");
    expect(breaker.state).toBe("closed");
  });

  it("opens after reaching consecutive failure threshold", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 50 });

    await expect(breaker.execute(() => Promise.reject(new Error("fail 1")))).rejects.toThrow();
    expect(breaker.state).toBe("closed");

    await expect(breaker.execute(() => Promise.reject(new Error("fail 2")))).rejects.toThrow();
    expect(breaker.state).toBe("open");

    // Rejects immediately while open without executing operation
    await expect(breaker.execute(() => Promise.resolve("ok"))).rejects.toThrowError(
      /circuit breaker is open/i,
    );
  });

  it("transitions to half-open after reset timeout and closes on successful probe", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 20 });

    await expect(breaker.execute(() => Promise.reject(new Error("fail")))).rejects.toThrow();
    expect(breaker.state).toBe("open");

    // Wait for cooldown
    await new Promise((resolve) => setTimeout(resolve, 30));

    const result = await breaker.execute(() => Promise.resolve("recovered"));
    expect(result).toBe("recovered");
    expect(breaker.state).toBe("closed");
  });
});

describe("TS-13 ResilientModelGateway", () => {
  it("retries transient rate-limit errors and succeeds", async () => {
    const fake = new FakeModelGateway([
      {
        outcome: "failure",
        failure: { code: "rate-limit", message: "Too many requests", retryAfterMs: 5 },
      },
      {
        outcome: "success",
        run: sampleSuccessRun,
      },
    ]);

    const resilient = new ResilientModelGateway({
      primary: fake,
      maxRetries: 2,
      baseRetryDelayMs: 5,
    });

    const run = await resilient.generate(sampleRequest);
    expect(run.output).toEqual({ draft: "Clean visit." });
  });

  it("does not retry deterministic invalid-output or auth failures", async () => {
    let callCount = 0;
    const fake = new FakeModelGateway([
      {
        outcome: "failure",
        failure: { code: "auth", message: "Invalid API key" },
      },
    ]);

    const countingGateway = {
      generate: (req: ModelRequest, sig?: AbortSignal) => {
        callCount++;
        return fake.generate(req, sig);
      },
    };

    const resilient = new ResilientModelGateway({
      primary: countingGateway,
      maxRetries: 3,
    });

    await expect(resilient.generate(sampleRequest)).rejects.toThrowError(
      expect.objectContaining<Partial<ModelGatewayError>>({ code: "auth" }),
    );
    expect(callCount).toBe(1);
  });

  it("fails over from primary to fallback gateway when primary is unavailable", async () => {
    const primaryFake = new FakeModelGateway([
      {
        outcome: "failure",
        failure: { code: "unavailable", message: "Service unavailable" },
      },
      {
        outcome: "failure",
        failure: { code: "unavailable", message: "Service unavailable" },
      },
    ]);

    const fallbackSuccessRun: ModelRun = {
      ...sampleSuccessRun,
      attempt: {
        ...sampleSuccessRun.attempt,
        provider: "openai-fallback",
      },
    };

    const fallbackFake = new FakeModelGateway([
      {
        outcome: "success",
        run: fallbackSuccessRun,
      },
    ]);

    const resilient = new ResilientModelGateway({
      primary: primaryFake,
      fallback: fallbackFake,
      maxRetries: 1,
      baseRetryDelayMs: 2,
    });

    const run = await resilient.generate(sampleRequest);
    expect(run.attempt.provider).toBe("openai-fallback");
    expect(run.attempt.receipt.metadata?.["fallbackUsed"]).toBe(true);
  });
});
