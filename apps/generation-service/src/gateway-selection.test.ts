import type { GenerationWorkloadDto } from "@review/contracts/generation";
import { describe, expect, it } from "vitest";

import { selectGatewayForTest } from "./runtime.js";

function workloadRoutedTo(
  primaryProvider: string,
  { monthlyBudgetMicros = primaryProvider === "fake" ? 0 : 1_000_000 } = {},
): GenerationWorkloadDto {
  const primaryModel =
    primaryProvider === "fake"
      ? "fake-v1"
      : primaryProvider === "openai"
        ? "gpt-4.1-mini"
        : "gemini-2.0-flash";
  return {
    bindings: {
      priceRateId: `price-${primaryProvider}`,
    },
    snapshot: {
      settings: { monthlyBudgetMicros },
      priceRates: [
        {
          id: `price-${primaryProvider}`,
          providerModelId: "provider-model-1",
          provider: primaryProvider,
          model: primaryModel,
        },
      ],
      providerRouting: {
        providerModelId: "provider-model-1",
        primaryProvider,
        primaryModel,
      },
    },
  } as unknown as GenerationWorkloadDto;
}

describe("provider routing decides the gateway", () => {
  it("uses only the provider resolved in the supplied snapshot", () => {
    const gateway = selectGatewayForTest({
      workload: workloadRoutedTo("fake"),
      providerMode: "paid-enabled",
      geminiApiKey: "a-gemini-key",
      openaiApiKey: "an-openai-key",
      fakeDelayMs: 0,
      fakeFailure: false,
    });

    expect(gateway.constructor.name).not.toBe("OpenAIProvider");
    expect(gateway.constructor.name).not.toBe("GeminiProvider");
  });

  it("keeps using the deterministic provider when configuration routes to it", () => {
    // Installing a credential must not redirect traffic that configuration
    // still routes to the fake provider: the model name would not exist there.
    const gateway = selectGatewayForTest({
      workload: workloadRoutedTo("fake"),
      providerMode: "paid-enabled",
      geminiApiKey: "a-real-key",
      fakeDelayMs: 0,
      fakeFailure: false,
    });

    expect(gateway).toBeDefined();
    expect(gateway.constructor.name).not.toBe("GeminiProvider");
  });

  it("uses Gemini only where configuration routes to Gemini", () => {
    const gateway = selectGatewayForTest({
      workload: workloadRoutedTo("gemini"),
      providerMode: "paid-enabled",
      geminiApiKey: "a-real-key",
      fakeDelayMs: 0,
      fakeFailure: false,
    });

    expect(gateway.constructor.name).toBe("GeminiProvider");
  });

  it("refuses every paid route when the deployment is independently fake-only", () => {
    expect(() =>
      selectGatewayForTest({
        workload: workloadRoutedTo("gemini"),
        providerMode: "fake-only",
        geminiApiKey: "a-stale-real-key",
        openaiApiKey: "another-stale-real-key",
        fakeDelayMs: 0,
        fakeFailure: false,
      }),
    ).toThrow(/LIVE_PROVIDER_DISABLED/u);
  });

  it("refuses rather than substituting when the routed provider has no credential", () => {
    expect(() =>
      selectGatewayForTest({
        workload: workloadRoutedTo("gemini"),
        providerMode: "paid-enabled",
        geminiApiKey: undefined,
        fakeDelayMs: 0,
        fakeFailure: false,
      }),
    ).toThrow(/CREDENTIAL_MISSING/);
  });

  it("refuses paid provider I/O when the resolved budget is zero", () => {
    expect(() =>
      selectGatewayForTest({
        workload: workloadRoutedTo("gemini", { monthlyBudgetMicros: 0 }),
        providerMode: "paid-enabled",
        geminiApiKey: "a-real-key",
        fakeDelayMs: 0,
        fakeFailure: false,
      }),
    ).toThrow(/PROVIDER_DISABLED/);
  });

  it("refuses OpenAI rather than substituting when its credential is absent", () => {
    expect(() =>
      selectGatewayForTest({
        workload: workloadRoutedTo("openai"),
        providerMode: "paid-enabled",
        geminiApiKey: "a-gemini-key",
        openaiApiKey: undefined,
        fakeDelayMs: 0,
        fakeFailure: false,
      }),
    ).toThrow(/CREDENTIAL_MISSING/);
  });

  it("fails closed for an unknown routed provider", () => {
    expect(() =>
      selectGatewayForTest({
        workload: workloadRoutedTo("unknown-provider"),
        providerMode: "paid-enabled",
        geminiApiKey: "a-gemini-key",
        openaiApiKey: "an-openai-key",
        fakeDelayMs: 0,
        fakeFailure: false,
      }),
    ).toThrow(/NOT_AVAILABLE/);
  });

  it("uses OpenAI only where configuration routes to OpenAI", () => {
    const gateway = selectGatewayForTest({
      workload: workloadRoutedTo("openai"),
      providerMode: "paid-enabled",
      geminiApiKey: undefined,
      openaiApiKey: "an-openai-key",
      fakeDelayMs: 0,
      fakeFailure: false,
    });

    expect(gateway.constructor.name).toBe("OpenAIProvider");
  });
});
