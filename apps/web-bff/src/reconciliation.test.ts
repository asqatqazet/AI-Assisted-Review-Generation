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
  it("settles a terminalized checkpoint without releasing its reservation", async () => {
    const operations: string[] = [];
    const recoveredWorkload = workload("checkpointed");
    const reconciler = createStaleGenerationReconciler({
      context: {
        listCandidates: async () => [
          {
            kind: "expired-lease",
            permitJti: "permit-checkpointed",
            leaseId: "lease-checkpointed",
            workload: recoveredWorkload,
          },
        ],
        settle: async (input) => {
          operations.push(`settle:${input.terminalReceipt}`);
          expect(input.workload).toBe(recoveredWorkload);
          return { status: "settled" as const };
        },
        release: async () => {
          throw new Error("a terminal checkpoint must settle, not release");
        },
      },
      generation: {
        status: async (input) => {
          operations.push(`status:${input.permitJti}`);
          expect(input.workload).toBe(recoveredWorkload);
          return {
            state: "terminal" as const,
            terminalReceipt: "signed-recovered-terminal",
          };
        },
        cancelExpired: async () => {
          throw new Error("a recovered terminal must not be cancelled");
        },
      },
    });

    await expect(reconciler()).resolves.toEqual({
      inspected: 1,
      released: 0,
      settled: 1,
      deferred: 0,
    });
    expect(operations).toEqual([
      "status:permit-checkpointed",
      "settle:signed-recovered-terminal",
    ]);
  });

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
          {
            kind: "expired-lease",
            permitJti: "permit-indeterminate",
            leaseId: "lease-indeterminate",
            workload: workload("indeterminate"),
          },
        ],
        release: async (input) => {
          operations.push(`release:${input.permitJti}:${input.outcome}`);
          return { status: "released" };
        },
        settle: async () => {
          throw new Error("no terminal candidate is expected");
        },
      },
      generation: {
        status: async (input) => {
          operations.push(`status:${input.permitJti}`);
          if (input.permitJti === "permit-running") {
            return {
              state: "running" as const,
              signedStatusReceipt: "signed-running",
            };
          }
          if (input.permitJti === "permit-indeterminate") {
            return {
              state: "indeterminate" as const,
              signedStatusReceipt: "signed-indeterminate",
            };
          }
          return input.permitJti === "permit-cancel"
            ? {
                state: "leased" as const,
                signedStatusReceipt: "signed-leased",
              }
            : {
                state: "no-lease" as const,
                signedStatusReceipt: "signed-no-lease",
              };
        },
        cancelExpired: async (input) => {
          operations.push(`cancel:${input.leaseId}`);
          return {
            state: "cancelled",
            signedStatusReceipt: "signed-cancelled",
          };
        },
      },
    });

    await expect(reconciler()).resolves.toEqual({
      inspected: 4,
      released: 2,
      settled: 0,
      deferred: 2,
    });
    expect(operations).toEqual([
      "status:permit-never",
      "release:permit-never:no-lease",
      "status:permit-cancel",
      "cancel:lease-cancel",
      "release:permit-cancel:cancelled",
      "status:permit-running",
      "status:permit-indeterminate",
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
        settle: async () => {
          throw new Error("not expected");
        },
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

  it("fails closed when Context rejects a recovered terminal receipt", async () => {
    let statusCalls = 0;
    const reconciler = createStaleGenerationReconciler({
      context: {
        listCandidates: async () => [
          {
            kind: "expired-lease",
            permitJti: "permit-checkpointed",
            leaseId: "lease-checkpointed",
            workload: workload("checkpointed"),
          },
        ],
        settle: async () => ({ status: "rejected" }),
        release: async () => {
          throw new Error("a terminal checkpoint must never be released");
        },
      },
      generation: {
        status: async () => {
          statusCalls += 1;
          return {
            state: "terminal",
            terminalReceipt: "signed-recovered-terminal",
          };
        },
        cancelExpired: async () => {
          throw new Error("a terminal checkpoint must never be cancelled");
        },
      },
    });

    await expect(reconciler()).rejects.toThrow(
      "RECONCILIATION_SETTLEMENT_REJECTED",
    );
    expect(statusCalls).toBe(1);
  });
});
