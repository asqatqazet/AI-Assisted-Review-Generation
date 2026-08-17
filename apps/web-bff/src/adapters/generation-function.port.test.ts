import { GenerationWorkloadDtoSchema } from "@review/contracts/generation";
import { describe, expect, it } from "vitest";

import { createInvokedReviewerGenerationExecutionPort } from "./generation-function.port.js";

const workload = GenerationWorkloadDtoSchema.parse({
  bindings: {
    tenantId: "tenant-a",
    locationId: "location-a",
    reviewSessionId: "review-session-a",
    generationBatchId: "batch-a",
    generationId: "generation-a",
    action: "generate",
    reviewFormatVersionId: "format-a@1",
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
    provenance: {
      locale: { scope: "tenant", sourceId: "tenant-a", revision: "tenant-r1" },
    },
    settings: {
      locale: "en-GB",
      toneGuidelines: "Warm and specific.",
      entryMode: "open-qr",
      requireDisclosure: false,
      requireVerifiedExperience: false,
      maxReviewFormatsPerRequest: 1,
      bannedTerms: [],
      enabledReviewFormatVersionIds: ["format-a@1"],
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

describe("invoked reviewer Generation execution port", () => {
  it("uses the strict private prepare contract", async () => {
    let received: unknown;
    const port = createInvokedReviewerGenerationExecutionPort({
      invoke: async (request) => {
        received = request;
        return {
          operation: "prepare",
          status: "leased",
          leaseId: "lease-a",
          leaseExpiresAt: "2026-08-17T10:01:00.000Z",
          leaseReceipt: "signed-lease",
        };
      },
    });

    await expect(
      port.prepare({ permit: "signed-permit", workload }),
    ).resolves.toEqual({ leaseId: "lease-a", leaseReceipt: "signed-lease" });
    expect(received).toEqual({
      operation: "prepare",
      permit: "signed-permit",
      workload,
    });
  });

  it("emits safe heartbeats while a private terminal result is pending", async () => {
    let resolveInvocation: ((value: unknown) => void) | undefined;
    const port = createInvokedReviewerGenerationExecutionPort(
      {
        invoke: async () =>
          await new Promise<unknown>((resolve) => {
            resolveInvocation = resolve;
          }),
      },
      { heartbeatMs: 5 },
    );
    const events: unknown[] = [];

    const collecting = (async () => {
      for await (const event of port.execute({
        leaseId: "lease-a",
        activation: "signed-activation",
        workload,
        signal: new AbortController().signal,
      })) {
        events.push(event);
        if (event.type === "heartbeat") {
          resolveInvocation?.({
            type: "terminal",
            status: "completed",
            terminalReceipt: "signed-terminal",
            draft: {
              id: "draft-a",
              generationId: "generation-a",
              revision: 1,
              text: "The team was attentive.",
            },
          });
        }
      }
    })();

    await collecting;
    expect(events).toEqual([
      { type: "progress", phase: "generating", elapsedSeconds: 0 },
      { type: "heartbeat", elapsedSeconds: 0 },
      {
        type: "terminal",
        status: "completed",
        terminalReceipt: "signed-terminal",
        draft: {
          id: "draft-a",
          generationId: "generation-a",
          revision: 1,
          text: "The team was attentive.",
        },
      },
    ]);
  });

  it("does not turn an invalid private result into a public Draft", async () => {
    const port = createInvokedReviewerGenerationExecutionPort({
      invoke: async () => ({
        type: "terminal",
        status: "completed",
        draft: {
          id: "draft-a",
          generationId: "generation-a",
          revision: 1,
          text: "Unsettled output",
        },
      }),
    });

    await expect(async () => {
      for await (const event of port.execute({
        leaseId: "lease-a",
        activation: "signed-activation",
        workload,
        signal: new AbortController().signal,
      })) {
        void event;
      }
    }).rejects.toThrow();
  });
});
