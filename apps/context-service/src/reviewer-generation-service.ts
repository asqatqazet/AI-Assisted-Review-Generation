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
  type ReviewerGenerationRejectionCodeDto,
} from "@review/contracts/generation";

export type ReviewerGenerationAdmissionCommand =
  | {
      readonly kind: "generate";
      readonly factOptionIds: readonly string[];
      readonly customerAssertion?: string | undefined;
      readonly reviewFormatVersionId: string;
    }
  | {
      readonly kind: "paraphrase";
      readonly sourceText: string;
      readonly reviewFormatVersionId: string;
    }
  | {
      readonly kind: "resample";
      readonly sourceGenerationId: string;
    }
  | {
      readonly kind: "reformat";
      readonly sourceGenerationId: string;
      readonly reviewFormatVersionId: string;
    }
  | {
      readonly kind: "condense";
      readonly sourceGenerationId: string;
      readonly targetMaxChars: number;
    }
  | {
      readonly kind: "expand";
      readonly sourceGenerationId: string;
      readonly targetMinChars: number;
    }
  | {
      readonly kind: "revise-wording";
      readonly sourceGenerationId: string;
      readonly presentationInstruction: string;
    };

export interface ReviewerGenerationAdmissionInput {
  readonly routeHandleHash: string;
  readonly browserCapabilityHash: string;
  readonly idempotencyKey: string;
  readonly command: ReviewerGenerationAdmissionCommand;
}

export type ReviewerGenerationAdmissionResult =
  | {
      readonly status: "prepared";
      readonly permitJti: string;
      readonly permitExpiresAt: string;
      readonly workload: Readonly<Record<string, unknown>>;
    }
  | {
      readonly status: "rejected";
      readonly code: ReviewerGenerationRejectionCodeDto;
      readonly retryable: boolean;
      readonly retryAfterSeconds?: number | undefined;
    };

export interface ReviewerGenerationAdmissionStore {
  prepare(
    input: ReviewerGenerationAdmissionInput,
  ): Promise<ReviewerGenerationAdmissionResult>;
  activate(input: {
    readonly tenantId: string;
    readonly locationId: string;
    readonly reviewSessionId: string;
    readonly generationBatchId: string;
    readonly generationId: string;
    readonly requestHash: string;
    readonly permitJti: string;
    readonly leaseId: string;
    readonly leaseExpiresAt: string;
  }): Promise<
    | {
        readonly status: "activated";
        readonly leaseId: string;
        readonly activationExpiresAt: string;
      }
    | { readonly status: "rejected" }
  >;
  settle(input: {
    readonly tenantId: string;
    readonly locationId: string;
    readonly reviewSessionId: string;
    readonly generationBatchId: string;
    readonly generationId: string;
    readonly requestHash: string;
    readonly permitJti: string;
    readonly leaseId: string;
    readonly actualCostMicros: number;
  }): Promise<
    { readonly status: "settled" } | { readonly status: "rejected" }
  >;
}

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
  readonly store: ReviewerGenerationAdmissionStore;
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
      let command: ReviewerGenerationAdmissionCommand;
      if ("factOptionIds" in input.command) {
        command = {
          kind: "generate",
          factOptionIds: input.command.factOptionIds,
          ...(input.command.customerAssertion === undefined
            ? {}
            : { customerAssertion: input.command.customerAssertion }),
          reviewFormatVersionId: input.command.reviewFormatId,
        };
      } else if ("sourceText" in input.command) {
        command = {
          kind: "paraphrase",
          sourceText: input.command.sourceText,
          reviewFormatVersionId: input.command.reviewFormatId,
        };
      } else if (input.command.action === "resample") {
        command = {
          kind: "resample",
          sourceGenerationId: input.command.sourceGenerationId,
        };
      } else if (input.command.action === "reformat") {
        command = {
          kind: "reformat",
          sourceGenerationId: input.command.sourceGenerationId,
          reviewFormatVersionId: input.command.reviewFormatId,
        };
      } else if (input.command.action === "condense") {
        command = {
          kind: "condense",
          sourceGenerationId: input.command.sourceGenerationId,
          targetMaxChars: input.command.targetMaxChars,
        };
      } else if (input.command.action === "expand") {
        command = {
          kind: "expand",
          sourceGenerationId: input.command.sourceGenerationId,
          targetMinChars: input.command.targetMinChars,
        };
      } else if (input.command.action === "revise-wording") {
        command = {
          kind: "revise-wording",
          sourceGenerationId: input.command.sourceGenerationId,
          presentationInstruction: input.command.presentationInstruction,
        };
      } else {
        throw new Error("REVIEWER_GENERATION_ACTION_NOT_IMPLEMENTED");
      }
      const prepared = await store.prepare({
        routeHandleHash: await hashCapability(input.reviewSessionHandle),
        browserCapabilityHash: await hashCapability(input.browserCapability),
        idempotencyKey: input.idempotencyKey,
        command,
      });
      if (prepared.status !== "prepared") {
        return {
          status: "rejected",
          code: prepared.code,
          retryable: prepared.retryable,
          ...(prepared.retryAfterSeconds === undefined
            ? {}
            : { retryAfterSeconds: prepared.retryAfterSeconds }),
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
