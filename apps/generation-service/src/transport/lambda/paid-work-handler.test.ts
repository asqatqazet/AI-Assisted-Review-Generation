import { describe, expect, it } from "vitest";

import { createPaidWorkGenerationHandler } from "./paid-work-handler.js";

const workload = {
  bindings: {
    tenantId: "tenant-a",
    locationId: "location-a",
    reviewSessionId: "session-a",
    generationBatchId: "batch-a",
    generationId: "generation-a",
    action: "generate" as const,
    reviewFormatVersionId: "format-a@1",
    assertionSetHash: "sha256:assertions",
    requestHash: "sha256:request",
    snapshotId: "snap-01",
    snapshotHash: "sha256:snapshot",
    idempotencyKey: "request-1",
  },
  snapshot: {
    snapshotId: "snap-01",
    schemaVersion: 1,
    tenantId: "tenant-a",
    locationId: "location-a",
    locale: "en-GB" as const,
    tenantName: "Brightsmile Dental",
    locationName: "Downtown Clinic",
    provenance: {
      locale: { scope: "tenant" as const, sourceId: "tenant-a", revision: "r1" },
    },
    policy: {
      requireDisclosure: false,
      requireVerifiedExperience: false,
      maxReviewFormatsPerRequest: 1,
      bannedTerms: [],
    },
    factOptions: [],
    reviewFormats: [],
    promptVersions: [],
    priceRates: [],
    providerRouting: { primaryProvider: "fake", primaryModel: "fake-v1" },
  },
  command: {
    kind: "generate" as const,
    assertionIds: ["assertion-a"],
    rating: 5,
  },
};

describe("US-03.2 paid-work Generation handler", () => {
  it("prepares and signs one finite lease without entering execution", async () => {
    let executionCalls = 0;
    let journalInput: unknown;
    const handler = createPaidWorkGenerationHandler({
      permitVerifier: {
        verify: async (permit, receivedWorkload) => {
          expect(permit).toBe("signed-context-permit");
          expect(receivedWorkload).toEqual(workload);
          return {
            permitJti: "permit-jti-a",
            expiresAt: "2026-08-17T12:01:00.000Z",
          };
        },
      },
      activationVerifier: {
        verify: async () => {
          throw new Error("activation verification must not run during prepare");
        },
      },
      leaseJournal: {
        prepare: async (input) => {
          journalInput = input;
          return {
            status: "leased",
            leaseId: "lease-a",
            leaseExpiresAt: "2026-08-17T12:00:45.000Z",
          };
        },
        claimExecution: async () => {
          throw new Error("Attempt claiming must not run during prepare");
        },
        status: async () => {
          throw new Error("status must not run during prepare");
        },
        cancelExpired: async () => {
          throw new Error("cancellation must not run during prepare");
        },
      },
      receiptSigner: {
        signLease: async (claims) => {
          expect(claims).toMatchObject({
            permitJti: "permit-jti-a",
            leaseId: "lease-a",
            generationId: "generation-a",
          });
          return "signed-generation-lease-receipt";
        },
        signStatus: async () => {
          throw new Error("status signing must not run during prepare");
        },
      },
      execute: async () => {
        executionCalls += 1;
      },
      tailExisting: async () => {
        throw new Error("tailing must not run during prepare");
      },
    });

    await expect(
      handler({
        operation: "prepare",
        permit: "signed-context-permit",
        workload,
      }),
    ).resolves.toEqual({
      operation: "prepare",
      status: "leased",
      leaseId: "lease-a",
      leaseExpiresAt: "2026-08-17T12:00:45.000Z",
      leaseReceipt: "signed-generation-lease-receipt",
    });

    expect(journalInput).toMatchObject({
      permitJti: "permit-jti-a",
      permitExpiresAt: "2026-08-17T12:01:00.000Z",
      workload,
    });
    expect(executionCalls).toBe(0);
  });

  it("claims Attempt 1 atomically before entering provider execution", async () => {
    const events: string[] = [];
    const handler = createPaidWorkGenerationHandler({
      permitVerifier: {
        verify: async () => ({
          permitJti: "permit-jti-a",
          expiresAt: "2026-08-17T12:01:00.000Z",
        }),
      },
      activationVerifier: {
        verify: async (activation, leaseId, receivedWorkload) => {
          events.push("activation-verified");
          expect(activation).toBe("signed-context-activation");
          expect(leaseId).toBe("lease-a");
          expect(receivedWorkload).toEqual(workload);
          return { expiresAt: "2026-08-17T12:00:40.000Z" };
        },
      },
      leaseJournal: {
        prepare: async () => {
          throw new Error("prepare must not run during execute");
        },
        claimExecution: async (input) => {
          events.push("attempt-claimed");
          expect(input).toMatchObject({
            leaseId: "lease-a",
            attemptOrdinal: 1,
            activationExpiresAt: "2026-08-17T12:00:40.000Z",
            workload,
          });
          return { status: "claimed", attemptId: "attempt-a" };
        },
        status: async () => {
          throw new Error("status must not run during execute");
        },
        cancelExpired: async () => {
          throw new Error("cancellation must not run during execute");
        },
      },
      receiptSigner: {
        signLease: async () => {
          throw new Error("lease signing must not run during execute");
        },
        signStatus: async () => {
          throw new Error("status signing must not run during execute");
        },
      },
      execute: async (input) => {
        events.push("provider-entered");
        expect(input).toEqual({ attemptId: "attempt-a", workload });
        return { status: "completed", generationId: "generation-a" };
      },
      tailExisting: async () => {
        throw new Error("a winning execution must not tail");
      },
    });

    await expect(
      handler({
        operation: "execute",
        leaseId: "lease-a",
        activation: "signed-context-activation",
        workload,
      }),
    ).resolves.toEqual({ status: "completed", generationId: "generation-a" });
    expect(events).toEqual([
      "activation-verified",
      "attempt-claimed",
      "provider-entered",
    ]);
  });

  it("tails the winner and never enters the provider on replay", async () => {
    let providerCalls = 0;
    const handler = createPaidWorkGenerationHandler({
      permitVerifier: {
        verify: async () => {
          throw new Error("permit verification is prepare-only");
        },
      },
      activationVerifier: {
        verify: async () => ({ expiresAt: "2026-08-17T12:00:40.000Z" }),
      },
      leaseJournal: {
        prepare: async () => {
          throw new Error("prepare must not run during execute");
        },
        claimExecution: async () => ({
          status: "existing",
          attemptId: "attempt-a",
        }),
        status: async () => {
          throw new Error("status must not run during execute");
        },
        cancelExpired: async () => {
          throw new Error("cancellation must not run during execute");
        },
      },
      receiptSigner: {
        signLease: async () => {
          throw new Error("lease signing must not run during execute");
        },
        signStatus: async () => {
          throw new Error("status signing must not run during execute");
        },
      },
      execute: async () => {
        providerCalls += 1;
        throw new Error("replay must not enter provider execution");
      },
      tailExisting: async (input) => {
        expect(input).toEqual({ attemptId: "attempt-a", workload });
        return { status: "completed", generationId: "generation-a" };
      },
    });

    await expect(
      handler({
        operation: "execute",
        leaseId: "lease-a",
        activation: "signed-context-activation",
        workload,
      }),
    ).resolves.toEqual({ status: "completed", generationId: "generation-a" });
    expect(providerCalls).toBe(0);
  });

  it.each([
    [
      {
        operation: "status" as const,
        scope: {
          tenantId: "tenant-a",
          locationId: "location-a",
          reviewSessionId: "session-a",
          generationBatchId: "batch-a",
          generationId: "generation-a",
          permitJti: "permit-jti-a",
        },
      },
      { operation: "status", state: "leased" },
    ],
    [
      {
        operation: "cancel-expired-lease" as const,
        leaseId: "lease-a",
        scope: {
          tenantId: "tenant-a",
          locationId: "location-a",
          reviewSessionId: "session-a",
          generationBatchId: "batch-a",
          generationId: "generation-a",
          permitJti: "permit-jti-a",
        },
      },
      { operation: "cancel-expired-lease", state: "cancelled" },
    ],
  ])("returns signed reconciliation evidence for $operation", async (event, unsigned) => {
    const handler = createPaidWorkGenerationHandler({
      permitVerifier: {
        verify: async () => {
          throw new Error("permit verification must not run during reconciliation");
        },
      },
      activationVerifier: {
        verify: async () => {
          throw new Error("activation verification must not run during reconciliation");
        },
      },
      leaseJournal: {
        prepare: async () => {
          throw new Error("prepare must not run during reconciliation");
        },
        claimExecution: async () => {
          throw new Error("execution claim must not run during reconciliation");
        },
        status: async (scope) => {
          expect(scope).toEqual(event.scope);
          return { state: "leased" };
        },
        cancelExpired: async (input) => {
          expect(input).toEqual({ leaseId: "lease-a", scope: event.scope });
          return { state: "cancelled" };
        },
      },
      receiptSigner: {
        signLease: async () => {
          throw new Error("lease signing must not run during reconciliation");
        },
        signStatus: async (claims) => {
          expect(claims).toEqual(unsigned);
          return "signed-generation-status-receipt";
        },
      },
      execute: async () => {
        throw new Error("provider must not run during reconciliation");
      },
      tailExisting: async () => {
        throw new Error("tail must not run during reconciliation");
      },
    });

    await expect(handler(event)).resolves.toEqual({
      ...unsigned,
      signedStatusReceipt: "signed-generation-status-receipt",
    });
  });
});
