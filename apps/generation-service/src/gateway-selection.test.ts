import type { GenerationWorkloadDto } from "@review/contracts/generation";
import { describe, expect, it } from "vitest";

import { selectGatewayForTest } from "./runtime.js";

function workloadRoutedTo(primaryProvider: string): GenerationWorkloadDto {
  return {
    snapshot: {
      providerRouting: {
        providerModelId: "provider-model-1",
        primaryProvider,
        primaryModel: primaryProvider === "fake" ? "fake-v1" : "gemini-2.0-flash",
      },
    },
  } as unknown as GenerationWorkloadDto;
}

describe("provider routing decides the gateway", () => {
  it("keeps using the deterministic provider when configuration routes to it", () => {
    // Installing a credential must not redirect traffic that configuration
    // still routes to the fake provider: the model name would not exist there.
    const gateway = selectGatewayForTest({
      routedProvider: "fake",
      workload: workloadRoutedTo("fake"),
      geminiApiKey: "a-real-key",
      fakeDelayMs: 0,
      fakeFailure: false,
    });

    expect(gateway).toBeDefined();
    expect(gateway.constructor.name).not.toBe("GeminiProvider");
  });

  it("uses Gemini only where configuration routes to Gemini", () => {
    const gateway = selectGatewayForTest({
      routedProvider: "gemini",
      workload: workloadRoutedTo("gemini"),
      geminiApiKey: "a-real-key",
      fakeDelayMs: 0,
      fakeFailure: false,
    });

    expect(gateway.constructor.name).toBe("GeminiProvider");
  });

  it("refuses rather than substituting when the routed provider has no credential", () => {
    expect(() =>
      selectGatewayForTest({
        routedProvider: "gemini",
        workload: workloadRoutedTo("gemini"),
        geminiApiKey: undefined,
        fakeDelayMs: 0,
        fakeFailure: false,
      }),
    ).toThrow(/CREDENTIAL_MISSING/);
  });

  it("refuses a provider this deployment cannot run", () => {
    expect(() =>
      selectGatewayForTest({
        routedProvider: "openai",
        workload: workloadRoutedTo("openai"),
        geminiApiKey: "a-real-key",
        fakeDelayMs: 0,
        fakeFailure: false,
      }),
    ).toThrow(/NOT_AVAILABLE/);
  });
});
