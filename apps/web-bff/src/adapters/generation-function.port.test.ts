import { GenerationWorkloadDtoSchema } from "@review/contracts/generation";
import { describe, expect, it } from "vitest";

import { createInvokedReconciliationContextPort } from "./context-function.port.js";
import {
  createInvokedConsoleBenchExecutionPort,
  createInvokedReconciliationGenerationPort,
  createInvokedReviewerGenerationExecutionPort,
} from "./generation-function.port.js";

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
      minimumFactSelections: 1,
      maximumCustomerAssertionChars: 4000,
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

describe("invoked reconciliation Context port", () => {
  it("settles a recovered terminal receipt against its immutable workload", async () => {
    let received: unknown;
    const port = createInvokedReconciliationContextPort({
      invoke: async (request) => {
        received = request;
        return {
          operation: "settle-generation",
          result: { status: "settled" },
        };
      },
    });

    await expect(
      port.settle({
        terminalReceipt: "signed-recovered-terminal",
        workload,
      }),
    ).resolves.toEqual({ status: "settled" });
    expect(received).toEqual({
      operation: "settle-generation",
      input: {
        terminalReceipt: "signed-recovered-terminal",
        workload,
      },
    });
  });
});

describe("invoked reviewer Generation execution port", () => {
  it("recovers a terminal checkpoint through the strict status contract", async () => {
    let received: unknown;
    const port = createInvokedReconciliationGenerationPort({
      invoke: async (request) => {
        received = request;
        return {
          operation: "status",
          state: "terminal",
          terminalReceipt: "signed-recovered-terminal",
        };
      },
    });

    await expect(
      port.status({ permitJti: "permit-a", workload }),
    ).resolves.toEqual({
      operation: "status",
      state: "terminal",
      terminalReceipt: "signed-recovered-terminal",
    });
    expect(received).toEqual({
      operation: "status",
      permitJti: "permit-a",
      workload,
    });
  });

  it("uses the dedicated non-streaming Bench operation", async () => {
    let received: unknown;
    const port = createInvokedConsoleBenchExecutionPort({
      invoke: async (request) => {
        received = request;
        return { operation: "console-bench", result: { status: "not-found" } };
      },
    });
    await expect(
      port.execute({ receipt: "signed-bench", workload }),
    ).resolves.toEqual({ status: "not-found" });
    expect(received).toEqual({
      operation: "console-bench",
      input: { receipt: "signed-bench", workload },
    });
  });

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
              systemAnnotations: [],
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
          systemAnnotations: [],
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
