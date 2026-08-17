import type {
  GenerationStatusInvocationDto,
  GenerationWorkloadDto,
} from "@review/contracts/generation";

type GenerationExecutionScope = GenerationStatusInvocationDto["scope"];

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
}

export interface ReconciliationGenerationPort {
  status(input: { readonly scope: GenerationExecutionScope }): Promise<{
    readonly state: "no-lease" | "leased" | "running" | "cancelled" | "terminal";
    readonly signedStatusReceipt: string;
  }>;
  cancelExpired(input: {
    readonly leaseId: string;
    readonly scope: GenerationExecutionScope;
  }): Promise<{
    readonly state: "cancelled" | "running" | "terminal" | "no-lease";
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
  readonly deferred: number;
}> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("RECONCILIATION_LIMIT_INVALID");
  }

  return async () => {
    const candidates = await context.listCandidates({ limit });
    let released = 0;
    let deferred = 0;

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
      if (candidate.kind === "never-leased") {
        const status = await generation.status({ scope });
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

      const status = await generation.cancelExpired({
        leaseId: candidate.leaseId,
        scope,
      });
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
      deferred,
    };
  };
}
