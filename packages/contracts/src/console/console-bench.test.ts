import { describe, expect, it } from "vitest";

import {
  ConsoleBenchInvocationDtoSchema,
  ConsoleBenchInvocationResultDtoSchema,
} from "./console-bench.js";
import { AuthorizeConsoleBenchInvocationDtoSchema } from "./console-function.js";

describe("Console Bench remote contracts", () => {
  it("keeps Context authorization and Generation execution as two distinct calls", () => {
    const input = {
      action: "generate",
      styleId: "format-short-v1",
      promptVersionId: "prompt-generate-v1",
      provider: "fake",
      keywordIds: ["fact-kind-v1"],
      freeText: "",
      sourceText: "",
    } as const;

    expect(
      AuthorizeConsoleBenchInvocationDtoSchema.parse({
        operation: "authorize-console-bench",
        input: {
          identity: {
            issuer: "https://issuer.example",
            subject: "operator-1",
            email: "operator@example.test",
          },
          scope: { tenantId: "tenant-a", locationId: "location-a" },
          input,
        },
      }),
    ).toMatchObject({ operation: "authorize-console-bench" });

    expect(
      ConsoleBenchInvocationDtoSchema.safeParse({
        operation: "console-bench",
        input: { receipt: "signed-receipt", workload: {} },
      }).success,
    ).toBe(false);
  });

  it("requires a grounding guard on every successful Bench result", () => {
    const parsed = ConsoleBenchInvocationResultDtoSchema.safeParse({
      operation: "console-bench",
      result: {
        status: "completed",
        result: {
          generationId: "bench-generation-a",
          output: "Draft",
          claims: [],
          removedClaims: [],
          provider: "fake",
          model: "fake-v1",
          latencyMs: 1,
          estimatedCost: { amountMicros: 0, currency: "EUR" },
          isBench: true,
        },
      },
    });
    expect(parsed.success).toBe(false);
  });
});
