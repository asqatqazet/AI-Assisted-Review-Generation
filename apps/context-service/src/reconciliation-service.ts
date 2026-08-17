import type {
  ListReconciliationCandidatesInvocationDto,
  ListReconciliationCandidatesInvocationResultDto,
  ReleaseReconciledGenerationInvocationDto,
  ReleaseReconciledGenerationInvocationResultDto,
} from "@review/contracts/context";
import { GenerationWorkloadDtoSchema } from "@review/contracts/generation";
import type { PostgresReviewerGenerationAdmissionStore } from "@review/db/admission";

import type { ContextGenerationStatusAuthority } from "./reviewer-generation-service.js";

type Store = Pick<
  PostgresReviewerGenerationAdmissionStore,
  "listReconciliationCandidates" | "releaseReconciled"
>;

export function createReconciliationService({
  store,
  authority,
}: {
  readonly store: Store;
  readonly authority: ContextGenerationStatusAuthority;
}): {
  listReconciliationCandidates(
    input: ListReconciliationCandidatesInvocationDto["input"],
  ): Promise<ListReconciliationCandidatesInvocationResultDto["result"]>;
  releaseReconciledGeneration(
    input: ReleaseReconciledGenerationInvocationDto["input"],
  ): Promise<ReleaseReconciledGenerationInvocationResultDto["result"]>;
} {
  return {
    async listReconciliationCandidates(input) {
      const candidates = await store.listReconciliationCandidates(input);
      return {
        candidates: candidates.map((candidate) => ({
          ...candidate,
          workload: GenerationWorkloadDtoSchema.parse(candidate.workload),
        })),
      };
    },

    async releaseReconciledGeneration(input) {
      const workload = GenerationWorkloadDtoSchema.parse(input.workload);
      const bindings = {
        tenantId: workload.bindings.tenantId,
        locationId: workload.bindings.locationId,
        reviewSessionId: workload.bindings.reviewSessionId,
        generationBatchId: workload.bindings.generationBatchId,
        generationId: workload.bindings.generationId,
        requestHash: workload.bindings.requestHash,
        permitJti: input.permitJti,
      };
      if (input.outcome === "no-lease") {
        await authority.verifyStatus(input.signedStatusReceipt, {
          operation: "status",
          outcome: input.outcome,
          permitJti: input.permitJti,
          workload,
        });
        return await store.releaseReconciled({
          outcome: input.outcome,
          ...bindings,
        });
      }
      await authority.verifyStatus(input.signedStatusReceipt, {
        operation: "cancel-expired-lease",
        outcome: input.outcome,
        permitJti: input.permitJti,
        leaseId: input.leaseId,
        workload,
      });
      return await store.releaseReconciled({
        outcome: input.outcome,
        leaseId: input.leaseId,
        ...bindings,
      });
    },
  };
}
