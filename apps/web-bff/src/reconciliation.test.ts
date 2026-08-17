import type { GenerationWorkloadDto } from "@review/contracts/generation";
import { describe, expect, it } from "vitest";

import { createStaleGenerationReconciler } from "./reconciliation.js";

const workload = (generationId: string) =>
  ({
    bindings: {
      tenantId: "tenant-a",
      locationId: "location-a",
      reviewSessionId: "session-a",
      generationBatchId: `batch-${generationId}`,
      generationId,
    },
  }) as GenerationWorkloadDto;

describe("D12 stale paid-work reconciliation", () => {
  it("releases only Generation-signed no-lease and cancelled outcomes", async () => {
    const operations: string[] = [];
    const reconciler = createStaleGenerationReconciler({
      context: {
        listCandidates: async () => [
          {
            kind: "never-leased",
            permitJti: "permit-never",
            workload: workload("never"),
          },
          {
            kind: "expired-lease",
            permitJti: "permit-cancel",
            leaseId: "lease-cancel",
            workload: workload("cancel"),
          },
          {
            kind: "expired-lease",
            permitJti: "permit-running",
            leaseId: "lease-running",
            workload: workload("running"),
          },
        ],
        release: async (input) => {
          operations.push(`release:${input.permitJti}:${input.outcome}`);
          return { status: "released" };
        },
      },
      generation: {
        status: async (input) => {
          operations.push(`status:${input.scope.permitJti}`);
          return {
            state: "no-lease",
            signedStatusReceipt: "signed-no-lease",
          };
        },
        cancelExpired: async (input) => {
          operations.push(`cancel:${input.leaseId}`);
          return input.leaseId === "lease-cancel"
            ? {
                state: "cancelled",
                signedStatusReceipt: "signed-cancelled",
              }
            : {
                state: "running",
                signedStatusReceipt: "signed-running",
              };
        },
      },
    });

    await expect(reconciler()).resolves.toEqual({
      inspected: 3,
      released: 2,
      deferred: 1,
    });
    expect(operations).toEqual([
      "status:permit-never",
      "release:permit-never:no-lease",
      "cancel:lease-cancel",
      "release:permit-cancel:cancelled",
      "cancel:lease-running",
    ]);
  });

  it("fails closed when Context rejects signed release evidence", async () => {
    const reconciler = createStaleGenerationReconciler({
      context: {
        listCandidates: async () => [
          {
            kind: "never-leased",
            permitJti: "permit-a",
            workload: workload("a"),
          },
        ],
        release: async () => ({ status: "rejected" }),
      },
      generation: {
        status: async () => ({
          state: "no-lease",
          signedStatusReceipt: "signed-no-lease",
        }),
        cancelExpired: async () => {
          throw new Error("not expected");
        },
      },
    });

    await expect(reconciler()).rejects.toThrow("RECONCILIATION_RELEASE_REJECTED");
  });
});
