import { GenerationWorkloadDtoSchema } from "@review/contracts/generation";
import { describe, expect, it } from "vitest";

import {
  ActivateGenerationInvocationDtoSchema,
  ContextFunctionInvocationDtoSchema,
  PrepareReviewerGenerationInvocationDtoSchema,
  SettleGenerationInvocationDtoSchema,
} from "./context-function.js";

const workload = GenerationWorkloadDtoSchema.parse({
  bindings: {
    tenantId: "tenant-a",
    locationId: "location-a",
    reviewSessionId: "review-session-a",
    generationBatchId: "batch-a",
    generationId: "generation-a",
    action: "generate",
    reviewFormatVersionId: "format-a",
    assertionSetHash: "sha256:assertions",
    requestHash: "sha256:request",
    snapshotId: "snapshot-a",
    snapshotHash: "sha256:snapshot",
    providerModelId: "provider-model-fake",
    priceRateId: "price-rate-fake",
    idempotencyKey: "request-a",
  },
  snapshot: {
    snapshotId: "snapshot-a",
    schemaVersion: 2,
    tenantId: "tenant-a",
    locationId: "location-a",
    tenantName: "Apex Dental",
    locationName: "Central Clinic",
    provenance: {},
    settings: {
      locale: "en-GB",
      toneGuidelines: "Warm and specific.",
      entryMode: "open-qr",
      requireDisclosure: false,
      requireVerifiedExperience: false,
      maxReviewFormatsPerRequest: 1,
      bannedTerms: [],
      enabledReviewFormatVersionIds: ["format-a"],
      enabledCommands: ["generate"],
      monthlyBudgetMicros: 0,
      alertThresholdPct: 80,
    },
    factOptions: [],
    reviewFormats: [],
    promptVersions: [],
    priceRates: [
      {
        id: "price-rate-fake",
        providerModelId: "provider-model-fake",
        provider: "fake",
        model: "fake-v1",
        inputPerMillionMicros: 0,
        outputPerMillionMicros: 0,
        currency: "EUR",
        unit: "token",
        effectiveFrom: "2026-08-17T00:00:00.000Z",
        effectiveTo: null,
      },
    ],
    providerRouting: {
      version: "routing-v1",
      providerModelId: "provider-model-fake",
      primaryProvider: "fake",
      primaryModel: "fake-v1",
    },
  },
  command: {
    kind: "generate",
    assertionIds: ["assertion-a"],
    rating: 4,
  },
  assertions: [
    {
      id: "assertion-a",
      version: "assertion-a@1",
      reviewSessionId: "review-session-a",
      semanticId: "attentive-service",
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

describe("private Context Generation function contract", () => {
  it("accepts only a browser-bound, idempotent prepare command", () => {
    const invocation = PrepareReviewerGenerationInvocationDtoSchema.parse({
      operation: "prepare-reviewer-generation",
      input: {
        reviewSessionHandle: "review-session-route-a",
        browserCapability: "browser-capability-123456789",
        idempotencyKey: "request-a",
        command: {
          factOptionIds: ["fact-a"],
          reviewFormatId: "format-a",
        },
      },
    });

    expect(ContextFunctionInvocationDtoSchema.parse(invocation)).toEqual(invocation);
    expect(() =>
      PrepareReviewerGenerationInvocationDtoSchema.parse({
        ...invocation,
        input: { ...invocation.input, tenantId: "attacker-chosen-tenant" },
      }),
    ).toThrow();
  });

  it("requires the complete resolved workload for activation and settlement", () => {
    const activation = ActivateGenerationInvocationDtoSchema.parse({
      operation: "activate-generation",
      input: {
        leaseId: "lease-a",
        leaseReceipt: "signed-lease-receipt",
        workload,
      },
    });
    const settlement = SettleGenerationInvocationDtoSchema.parse({
      operation: "settle-generation",
      input: {
        terminalReceipt: "signed-terminal-receipt",
        workload,
      },
    });

    expect(ContextFunctionInvocationDtoSchema.parse(activation)).toEqual(activation);
    expect(ContextFunctionInvocationDtoSchema.parse(settlement)).toEqual(settlement);
  });
});
