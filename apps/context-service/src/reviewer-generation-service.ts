import type {
  ActivateGenerationInvocationDto,
  ActivateGenerationInvocationResultDto,
  PrepareReviewerGenerationInvocationDto,
  PrepareReviewerGenerationInvocationResultDto,
  SettleGenerationInvocationDto,
  SettleGenerationInvocationResultDto,
} from "@review/contracts/context";
import {
  GenerationWorkloadDtoSchema,
  type GenerationWorkloadDto,
} from "@review/contracts/generation";
import type { PostgresReviewerGenerationAdmissionStore } from "@review/db/admission";

type AdmissionStore = Pick<
  PostgresReviewerGenerationAdmissionStore,
  "prepare" | "activate" | "settle"
>;

export interface ContextGenerationAuthority {
  signPermit(input: {
    readonly permitJti: string;
    readonly expiresAt: string;
    readonly workload: GenerationWorkloadDto;
  }): Promise<string>;
  verifyLease(
    receipt: string,
    workload: GenerationWorkloadDto,
  ): Promise<{
    readonly permitJti: string;
    readonly leaseId: string;
    readonly leaseExpiresAt: string;
  }>;
  signActivation(input: {
    readonly permitJti: string;
    readonly leaseId: string;
    readonly expiresAt: string;
    readonly workload: GenerationWorkloadDto;
  }): Promise<string>;
  verifyTerminal(
    receipt: string,
    workload: GenerationWorkloadDto,
  ): Promise<{
    readonly permitJti: string;
    readonly leaseId: string;
    readonly actualCostMicros: number;
    readonly outcome: "completed" | "rejected";
  }>;
}

export interface ContextGenerationStatusAuthority {
  verifyStatus(
    receipt: string,
    expected:
      | {
          readonly operation: "status";
          readonly outcome: "no-lease";
          readonly permitJti: string;
          readonly workload: GenerationWorkloadDto;
        }
      | {
          readonly operation: "cancel-expired-lease";
          readonly outcome: "cancelled";
          readonly permitJti: string;
          readonly leaseId: string;
          readonly workload: GenerationWorkloadDto;
        },
  ): Promise<void>;
}

export interface ReviewerGenerationServiceOptions {
  readonly store: AdmissionStore;
  readonly authority: ContextGenerationAuthority;
  readonly hashCapability: (value: string) => Promise<string>;
}

export interface ReviewerGenerationService {
  prepareReviewerGeneration(
    input: PrepareReviewerGenerationInvocationDto["input"],
  ): Promise<PrepareReviewerGenerationInvocationResultDto["result"]>;
  activateGeneration(
    input: ActivateGenerationInvocationDto["input"],
  ): Promise<ActivateGenerationInvocationResultDto["result"]>;
  settleGeneration(
    input: SettleGenerationInvocationDto["input"],
  ): Promise<SettleGenerationInvocationResultDto["result"]>;
}

const bindingsForStore = (workload: GenerationWorkloadDto) => ({
  tenantId: workload.bindings.tenantId,
  locationId: workload.bindings.locationId,
  reviewSessionId: workload.bindings.reviewSessionId,
  generationBatchId: workload.bindings.generationBatchId,
  generationId: workload.bindings.generationId,
  requestHash: workload.bindings.requestHash,
});

export function createReviewerGenerationService({
  store,
  authority,
  hashCapability,
}: ReviewerGenerationServiceOptions): ReviewerGenerationService {
  return {
    async prepareReviewerGeneration(input) {
      const prepared = await store.prepare({
        routeHandleHash: await hashCapability(input.reviewSessionHandle),
        browserCapabilityHash: await hashCapability(input.browserCapability),
        idempotencyKey: input.idempotencyKey,
        factOptionIds: input.command.factOptionIds,
        ...(input.command.customerAssertion === undefined
          ? {}
          : { customerAssertion: input.command.customerAssertion }),
        reviewFormatVersionId: input.command.reviewFormatId,
      });
      if (prepared.status !== "prepared") {
        return {
          status: "rejected",
          code: "GENERATION_FAILED",
          retryable: true,
        };
      }
      const workload = GenerationWorkloadDtoSchema.parse(prepared.workload);
      return {
        status: "prepared",
        permit: await authority.signPermit({
          permitJti: prepared.permitJti,
          expiresAt: prepared.permitExpiresAt,
          workload,
        }),
        workload,
      };
    },

    async activateGeneration(input) {
      const workload = GenerationWorkloadDtoSchema.parse(input.workload);
      const lease = await authority.verifyLease(input.leaseReceipt, workload);
      if (lease.leaseId !== input.leaseId) {
        return { status: "rejected" };
      }
      const activation = await store.activate({
        ...bindingsForStore(workload),
        permitJti: lease.permitJti,
        leaseId: lease.leaseId,
        leaseExpiresAt: lease.leaseExpiresAt,
      });
      if (activation.status !== "activated") {
        return { status: "rejected" };
      }
      return {
        status: "activated",
        activation: await authority.signActivation({
          permitJti: lease.permitJti,
          leaseId: lease.leaseId,
          expiresAt: activation.activationExpiresAt,
          workload,
        }),
      };
    },

    async settleGeneration(input) {
      const workload = GenerationWorkloadDtoSchema.parse(input.workload);
      const terminal = await authority.verifyTerminal(
        input.terminalReceipt,
        workload,
      );
      return await store.settle({
        ...bindingsForStore(workload),
        permitJti: terminal.permitJti,
        leaseId: terminal.leaseId,
        actualCostMicros: terminal.actualCostMicros,
      });
    },
  };
}
