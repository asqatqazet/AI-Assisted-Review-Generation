import { GenerationWorkloadDtoSchema } from "@review/contracts/generation";
import { describe, expect, it } from "vitest";

import { createReviewerGenerationService } from "./reviewer-generation-service.js";

const workload = GenerationWorkloadDtoSchema.parse({
  bindings: {
    tenantId: "tenant-a",
    locationId: "location-a",
    reviewSessionId: "session-a",
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
        effectiveFrom: "2026-08-01T00:00:00.000Z",
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
      version: "fact-a@1",
      reviewSessionId: "session-a",
      semanticId: "fact-a",
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

describe("US-03.2 Context reviewer Generation service", () => {
  it("derives all admission bindings from the browser capability and signed receipts", async () => {
    const operations: string[] = [];
    const service = createReviewerGenerationService({
      hashCapability: async (value) => `sha256:${value}`,
      store: {
        prepare: async (input) => {
          operations.push("store-prepare");
          expect(input).toEqual({
            routeHandleHash: "sha256:review-session-route-a",
            browserCapabilityHash: "sha256:browser-capability-123456789",
            idempotencyKey: "request-a",
            factOptionIds: ["fact-a"],
            customerAssertion: "The reception was calm.",
            reviewFormatVersionId: "format-a",
          });
          return {
            status: "prepared",
            permitJti: "permit-a",
            permitExpiresAt: "2026-08-17T12:01:00.000Z",
            workload,
          };
        },
        activate: async (input) => {
          operations.push("store-activate");
          expect(input).toMatchObject({
            tenantId: "tenant-a",
            generationId: "generation-a",
            permitJti: "permit-a",
            leaseId: "lease-a",
          });
          return {
            status: "activated",
            leaseId: "lease-a",
            activationExpiresAt: "2026-08-17T12:00:40.000Z",
          };
        },
        settle: async (input) => {
          operations.push("store-settle");
          expect(input).toMatchObject({
            tenantId: "tenant-a",
            generationId: "generation-a",
            permitJti: "permit-a",
            leaseId: "lease-a",
            actualCostMicros: 0,
          });
          return { status: "settled" };
        },
      },
      authority: {
        signPermit: async (claims) => {
          operations.push("permit-signed");
          expect(claims).toMatchObject({ permitJti: "permit-a", workload });
          return "signed-context-permit";
        },
        verifyLease: async (receipt, receivedWorkload) => {
          operations.push("lease-verified");
          expect(receipt).toBe("signed-generation-lease");
          expect(receivedWorkload).toEqual(workload);
          return {
            permitJti: "permit-a",
            leaseId: "lease-a",
            leaseExpiresAt: "2026-08-17T12:00:45.000Z",
          };
        },
        signActivation: async (claims) => {
          operations.push("activation-signed");
          expect(claims).toMatchObject({
            permitJti: "permit-a",
            leaseId: "lease-a",
            workload,
          });
          return "signed-context-activation";
        },
        verifyTerminal: async (receipt, receivedWorkload) => {
          operations.push("terminal-verified");
          expect(receipt).toBe("signed-generation-terminal");
          expect(receivedWorkload).toEqual(workload);
          return {
            permitJti: "permit-a",
            leaseId: "lease-a",
            actualCostMicros: 0,
            outcome: "completed" as const,
          };
        },
      },
    });

    await expect(
      service.prepareReviewerGeneration({
        reviewSessionHandle: "review-session-route-a",
        browserCapability: "browser-capability-123456789",
        idempotencyKey: "request-a",
        command: {
          factOptionIds: ["fact-a"],
          reviewFormatId: "format-a",
          customerAssertion: "The reception was calm.",
        },
      }),
    ).resolves.toEqual({
      status: "prepared",
      permit: "signed-context-permit",
      workload,
    });
    await expect(
      service.activateGeneration({
        leaseId: "lease-a",
        leaseReceipt: "signed-generation-lease",
        workload,
      }),
    ).resolves.toEqual({
      status: "activated",
      activation: "signed-context-activation",
    });
    await expect(
      service.settleGeneration({
        terminalReceipt: "signed-generation-terminal",
        workload,
      }),
    ).resolves.toEqual({ status: "settled" });
    expect(operations).toEqual([
      "store-prepare",
      "permit-signed",
      "lease-verified",
      "store-activate",
      "activation-signed",
      "terminal-verified",
      "store-settle",
    ]);
  });

  it("settles a signed rejected terminal so admission capacity is not stranded", async () => {
    let settled = false;
    const service = createReviewerGenerationService({
      hashCapability: async (value) => value,
      store: {
        prepare: async () => ({ status: "rejected" }),
        activate: async () => ({ status: "rejected" }),
        settle: async (input) => {
          settled = true;
          expect(input).toMatchObject({
            permitJti: "permit-a",
            leaseId: "lease-a",
            actualCostMicros: 0,
          });
          return { status: "settled" };
        },
      },
      authority: {
        signPermit: async () => "unused",
        verifyLease: async () => {
          throw new Error("unused");
        },
        signActivation: async () => "unused",
        verifyTerminal: async () => ({
          permitJti: "permit-a",
          leaseId: "lease-a",
          actualCostMicros: 0,
          outcome: "rejected",
        }),
      },
    });

    await expect(
      service.settleGeneration({
        terminalReceipt: "signed-rejected-terminal",
        workload,
      }),
    ).resolves.toEqual({ status: "settled" });
    expect(settled).toBe(true);
  });
});
