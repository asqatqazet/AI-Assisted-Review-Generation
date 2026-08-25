import type {
  CancelExpiredLeaseInvocationDto,
  GenerationWorkloadDto,
} from "@review/contracts/generation";

type GenerationExecutionScope = CancelExpiredLeaseInvocationDto["scope"];

export type StaleGenerationCandidate =
  | {
      readonly kind: "never-leased";
      readonly permitJti: string;
      readonly workload: GenerationWorkloadDto;
    }
  | {
      readonly kind: "expired-lease";
      readonly permitJti: string;
      readonly leaseId: string;
      readonly workload: GenerationWorkloadDto;
    };

export interface ReconciliationContextPort {
  listCandidates(input: {
    readonly limit: number;
  }): Promise<readonly StaleGenerationCandidate[]>;
  release(input:
    | {
        readonly outcome: "no-lease";
        readonly permitJti: string;
        readonly signedStatusReceipt: string;
        readonly workload: GenerationWorkloadDto;
      }
    | {
        readonly outcome: "cancelled";
        readonly permitJti: string;
        readonly leaseId: string;
        readonly signedStatusReceipt: string;
        readonly workload: GenerationWorkloadDto;
      }
  ): Promise<{ readonly status: "released" | "rejected" }>;
  settle(input: {
    readonly terminalReceipt: string;
    readonly workload: GenerationWorkloadDto;
  }): Promise<{ readonly status: "settled" | "rejected" }>;
}

export interface ReconciliationGenerationPort {
  status(input: {
    readonly permitJti: string;
    readonly workload: GenerationWorkloadDto;
  }): Promise<
    | {
        readonly state:
          | "no-lease"
          | "leased"
          | "running"
          | "indeterminate"
          | "cancelled";
        readonly signedStatusReceipt: string;
      }
    | {
        readonly state: "terminal";
        readonly terminalReceipt: string;
      }
  >;
  cancelExpired(input: {
    readonly leaseId: string;
    readonly scope: GenerationExecutionScope;
  }): Promise<{
    readonly state:
      | "cancelled"
      | "running"
      | "indeterminate"
      | "terminal"
      | "no-lease";
    readonly signedStatusReceipt: string;
  }>;
}

export function createStaleGenerationReconciler({
  context,
  generation,
  limit = 25,
}: {
  readonly context: ReconciliationContextPort;
  readonly generation: ReconciliationGenerationPort;
  readonly limit?: number;
}): () => Promise<{
  readonly inspected: number;
  readonly released: number;
  readonly settled: number;
  readonly deferred: number;
}> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("RECONCILIATION_LIMIT_INVALID");
  }

  return async () => {
    const candidates = await context.listCandidates({ limit });
    let released = 0;
    let settled = 0;
    let deferred = 0;

    const settleTerminal = async (
      terminalReceipt: string,
      workload: GenerationWorkloadDto,
    ): Promise<void> => {
      const result = await context.settle({ terminalReceipt, workload });
      if (result.status !== "settled") {
        throw new Error("RECONCILIATION_SETTLEMENT_REJECTED");
      }
      settled += 1;
    };

    for (const candidate of candidates) {
      const bindings = candidate.workload.bindings;
      const scope = {
        tenantId: bindings.tenantId,
        locationId: bindings.locationId,
        reviewSessionId: bindings.reviewSessionId,
        generationBatchId: bindings.generationBatchId,
        generationId: bindings.generationId,
        permitJti: candidate.permitJti,
      };
      const observed = await generation.status({
        permitJti: candidate.permitJti,
        workload: candidate.workload,
      });
      if (observed.state === "terminal") {
        await settleTerminal(
          observed.terminalReceipt,
          candidate.workload,
        );
        continue;
      }
      if (candidate.kind === "never-leased") {
        const status = observed;
        if (status.state !== "no-lease") {
          deferred += 1;
          continue;
        }
        const release = await context.release({
          outcome: "no-lease",
          permitJti: candidate.permitJti,
          signedStatusReceipt: status.signedStatusReceipt,
          workload: candidate.workload,
        });
        if (release.status !== "released") {
          throw new Error("RECONCILIATION_RELEASE_REJECTED");
        }
        released += 1;
        continue;
      }

      if (
        observed.state === "running" ||
        observed.state === "indeterminate"
      ) {
        deferred += 1;
        continue;
      }

      const status = await generation.cancelExpired({
        leaseId: candidate.leaseId,
        scope,
      });
      if (status.state === "terminal") {
        const recovered = await generation.status({
          permitJti: candidate.permitJti,
          workload: candidate.workload,
        });
        if (recovered.state === "terminal") {
          await settleTerminal(
            recovered.terminalReceipt,
            candidate.workload,
          );
          continue;
        }
        deferred += 1;
        continue;
      }
      if (status.state !== "cancelled") {
        deferred += 1;
        continue;
      }
      const release = await context.release({
        outcome: "cancelled",
        permitJti: candidate.permitJti,
        leaseId: candidate.leaseId,
        signedStatusReceipt: status.signedStatusReceipt,
        workload: candidate.workload,
      });
      if (release.status !== "released") {
        throw new Error("RECONCILIATION_RELEASE_REJECTED");
      }
      released += 1;
    }

    return {
      inspected: candidates.length,
      released,
      settled,
      deferred,
    };
  };
}
