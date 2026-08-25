import { GenerationWorkloadDtoSchema } from "@review/contracts/generation";
import { describe, expect, it, vi } from "vitest";

import {
  createConsoleBenchHandler,
  createNonPersistentConsoleBenchSink,
} from "./console-bench-handler.js";

const workload = GenerationWorkloadDtoSchema.parse({
  bindings: {
    tenantId: "tenant-a",
    locationId: "location-a",
    reviewSessionId: "bench-session-a",
    generationBatchId: "bench-batch-a",
    generationId: "bench-generation-a",
    action: "generate",
    reviewFormatVersionId: "format-a@1",
    assertionSetHash: "sha256:assertions",
    requestHash: "sha256:request",
    snapshotId: "snapshot-a",
    snapshotHash: "sha256:snapshot",
    providerModelId: "provider-model-fake-v1",
    priceRateId: "price-fake@1",
    idempotencyKey: "bench:request-a",
  },
  snapshot: {
    snapshotId: "snapshot-a",
    schemaVersion: 2,
    tenantId: "tenant-a",
    locationId: "location-a",
    tenantName: "Tenant A",
    locationName: "Location A",
    settings: {
      locale: "en-GB",
      toneGuidelines: "Warm.",
      entryMode: "invite",
      requireDisclosure: false,
      requireVerifiedExperience: false,
      maxReviewFormatsPerRequest: 1,
      minimumFactSelections: 1,
      maximumCustomerAssertionChars: 4000,
      bannedTerms: [],
      enabledReviewFormatVersionIds: ["format-a@1"],
      enabledCommands: ["generate"],
      monthlyBudgetMicros: 0,
      alertThresholdPct: 80,
    },
    provenance: {},
    factOptions: [],
    reviewFormats: [
      {
        id: "format-a@1",
        key: "short",
        version: "1.0.0",
        displayName: "Short",
        targetPlatform: "google",
        locale: "any",
        description: { "en-GB": "Short" },
        sample: { "en-GB": "The team was attentive." },
        constraints: {
          minChars: 1,
          maxChars: 400,
          paragraphs: 1,
          emojiPolicy: "none",
          secondPerson: false,
        },
        supportedCommands: ["generate"],
      },
    ],
    promptVersions: [
      {
        id: "prompt-generate@1",
        hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        key: "review.generate",
        commandKind: "generate",
        body: "Use only Assertions.",
        variables: [],
      },
    ],
    priceRates: [
      {
        id: "price-fake@1",
        providerModelId: "provider-model-fake-v1",
        provider: "fake",
        model: "fake-v1",
        inputPerMillionMicros: 0,
        outputPerMillionMicros: 0,
        currency: "EUR",
        unit: "token",
        effectiveFrom: "2026-01-01T00:00:00.000Z",
        effectiveTo: null,
      },
    ],
    providerRouting: {
      version: "routing-v1",
      providerModelId: "provider-model-fake-v1",
      primaryProvider: "fake",
      primaryModel: "fake-v1",
    },
  },
  command: { kind: "generate", assertionIds: ["assertion-a"], rating: 5 },
  assertions: [
    {
      id: "assertion-a",
      version: "assertion-a@1",
      reviewSessionId: "bench-session-a",
      semanticId: "service-attentive",
      proposition: "The team was attentive.",
      semanticKind: "experience-fact",
      polarity: "positive",
      source: {
        kind: "fact-option",
        factOptionId: "fact-a",
        factOptionVersion: "fact-a@1",
      },
    },
  ],
});

describe("Console Bench Generation handler", () => {
  it("verifies before entering the shared application pipeline", async () => {
    const prepareAttempt = vi.fn();
    const sink = createNonPersistentConsoleBenchSink();
    const handler = createConsoleBenchHandler({
      verifier: { verify: () => ({ status: "rejected" }) },
      prepareAttempt,
      sink,
    });

    await expect(
      handler({
        operation: "console-bench",
        input: { receipt: "wrong-receipt", workload },
      }),
    ).resolves.toEqual({
      operation: "console-bench",
      result: { status: "not-found" },
    });
    expect(prepareAttempt).not.toHaveBeenCalled();
  });

  it("returns the Draft, Claims and grounding guard through an explicit non-persistent zero-cost sink", async () => {
    const record = vi.fn(async () => undefined);
    const sink = createNonPersistentConsoleBenchSink({ record });
    const prepareAttempt = vi.fn(async () => ({
      requestPayload: {
        model: "fake-v1",
        messages: [],
        maxOutputTokens: 350,
        outputSchema: { name: "CandidateGeneration", schema: {} },
      },
      execute: async () => ({
        status: "completed" as const,
        generationId: workload.bindings.generationId,
        attemptId: "bench-attempt-a",
        providerOutput: {
          draft: "The team was attentive.",
          claims: [{ assertionIds: ["assertion-a"] }],
        },
        draft: "The team was attentive.",
        draftBody: "The team was attentive.",
        systemAnnotations: [],
        claims: [
          {
            id: "claim-a",
            semanticId: "service-attentive",
            semanticKind: "experience-fact" as const,
            polarity: "positive" as const,
            text: "The team was attentive.",
            grounding: [
              {
                kind: "assertion" as const,
                assertionId: "assertion-a",
                assertionVersion: "assertion-a@1",
              },
            ],
          },
        ],
        attempt: {
          provider: "fake",
          model: "fake-v1",
          usage: { inputTokens: 20, outputTokens: 5 },
          receipt: { requestId: "fake-a", finishReason: "stop" as const },
        },
      }),
    }));
    const ticks = [1_000, 1_025];
    const handler = createConsoleBenchHandler({
      verifier: { verify: () => ({ status: "verified" }) },
      prepareAttempt,
      sink,
      nowMs: () => ticks.shift() ?? 1_025,
      newAttemptId: () => "bench-attempt-a",
    });

    await expect(
      handler({
        operation: "console-bench",
        input: { receipt: "signed-receipt", workload },
      }),
    ).resolves.toEqual({
      operation: "console-bench",
      result: {
        status: "completed",
        result: {
          generationId: "bench-generation-a",
          output: "The team was attentive.",
          claims: [
            {
              id: "claim-a",
              text: "The team was attentive.",
              supportedBy: ["assertion-a"],
            },
          ],
          removedClaims: [],
          provider: "fake",
          model: "fake-v1",
          latencyMs: 25,
          estimatedCost: { amountMicros: 0, currency: "EUR" },
          isBench: true,
          guard: {
            verdict: "passed",
            supportedClaimIds: ["claim-a"],
            removedClaimCount: 0,
          },
        },
      },
    });
    expect(prepareAttempt).toHaveBeenCalledWith(workload);
    expect(sink.persistence).toBe("none");
    expect(record).toHaveBeenCalledOnce();
  });
});
