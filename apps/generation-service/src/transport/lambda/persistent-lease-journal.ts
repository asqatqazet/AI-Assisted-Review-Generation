import type { PostgresGenerationLeaseJournal } from "@review/db/execution-plane";

import type { GenerationLeaseJournal } from "./paid-work-handler.js";

type DatabaseJournal = Pick<
  PostgresGenerationLeaseJournal,
  "prepare" | "claimExecution" | "status" | "cancelExpired"
>;

export function createPersistentGenerationLeaseJournal(
  databaseJournal: DatabaseJournal,
): GenerationLeaseJournal {
  return {
    async prepare({ permitJti, permitExpiresAt, workload }) {
      return await databaseJournal.prepare({
        tenantId: workload.bindings.tenantId,
        locationId: workload.bindings.locationId,
        reviewSessionId: workload.bindings.reviewSessionId,
        generationBatchId: workload.bindings.generationBatchId,
        generationId: workload.bindings.generationId,
        permitJti,
        permitExpiresAt,
      });
    },

    async claimExecution({
      leaseId,
      permitJti,
      activationExpiresAt,
      attemptOrdinal,
      requestPayload,
      workload,
    }) {
      return await databaseJournal.claimExecution({
        tenantId: workload.bindings.tenantId,
        locationId: workload.bindings.locationId,
        reviewSessionId: workload.bindings.reviewSessionId,
        generationBatchId: workload.bindings.generationBatchId,
        generationId: workload.bindings.generationId,
        permitJti,
        leaseId,
        activationExpiresAt,
        attemptOrdinal,
        providerModelId: workload.bindings.providerModelId,
        priceRateId: workload.bindings.priceRateId,
        requestPayload,
      });
    },

    async status(scope) {
      return await databaseJournal.status(scope);
    },

    async cancelExpired({ leaseId, scope }) {
      return await databaseJournal.cancelExpired({ leaseId, ...scope });
    },
  };
}
