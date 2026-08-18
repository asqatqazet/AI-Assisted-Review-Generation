import {
  CancelExpiredLeaseResultDtoSchema,
  GenerationFunctionInvocationDtoSchema,
  GenerationStatusResultDtoSchema,
  PrivateGenerationTerminalEventDtoSchema,
  PrepareGenerationResultDtoSchema,
  type GenerationStatusInvocationDto,
  type GenerationWorkloadDto,
  type ReviewerDraftDto,
} from "@review/contracts/generation";

import type { CompletedPaidWorkAttemptResult } from "../../application/paid-work-attempt.js";

type GenerationExecutionScope = GenerationStatusInvocationDto["scope"];

export interface VerifiedGenerationPermit {
  readonly permitJti: string;
  readonly expiresAt: string;
}

export interface GenerationPermitVerifier {
  verify(
    permit: string,
    workload: GenerationWorkloadDto,
  ): Promise<VerifiedGenerationPermit>;
}

export interface PreparedGenerationLease {
  readonly status: "leased" | "existing";
  readonly leaseId: string;
  readonly leaseExpiresAt: string;
}

export interface GenerationLeaseJournal {
  prepare(input: {
    readonly permitJti: string;
    readonly permitExpiresAt: string;
    readonly workload: GenerationWorkloadDto;
  }): Promise<PreparedGenerationLease>;
  claimExecution(input: {
    readonly leaseId: string;
    readonly permitJti: string;
    readonly activationExpiresAt: string;
    readonly attemptOrdinal: 1;
    readonly requestPayload: unknown;
    readonly workload: GenerationWorkloadDto;
  }): Promise<
    | { readonly status: "claimed"; readonly attemptId: string }
    | { readonly status: "existing"; readonly attemptId: string }
  >;
  status(scope: GenerationExecutionScope): Promise<{
    readonly state: "no-lease" | "leased" | "running" | "cancelled" | "terminal";
  }>;
  cancelExpired(input: {
    readonly leaseId: string;
    readonly scope: GenerationExecutionScope;
  }): Promise<{
    readonly state: "cancelled" | "running" | "terminal" | "no-lease";
  }>;
}

export interface VerifiedGenerationActivation {
  readonly expiresAt: string;
  readonly permitJti: string;
}

export interface GenerationActivationVerifier {
  verify(
    activation: string,
    leaseId: string,
    workload: GenerationWorkloadDto,
  ): Promise<VerifiedGenerationActivation>;
}

export interface GenerationReceiptSigner {
  signLease(claims: {
    readonly permitJti: string;
    readonly leaseId: string;
    readonly leaseExpiresAt: string;
    readonly tenantId: string;
    readonly locationId: string;
    readonly reviewSessionId: string;
    readonly generationBatchId: string;
    readonly generationId: string;
    readonly action: string;
    readonly reviewFormatVersionId: string;
    readonly assertionSetHash: string;
    readonly requestHash: string;
    readonly snapshotId: string;
    readonly snapshotHash: string;
    readonly providerModelId: string;
    readonly priceRateId: string;
    readonly idempotencyKey: string;
  }): Promise<string>;
  signStatus(
    claims:
      | {
          readonly operation: "status";
          readonly state:
            | "no-lease"
            | "leased"
            | "running"
            | "cancelled"
            | "terminal";
          readonly scope: GenerationExecutionScope;
        }
      | {
          readonly operation: "cancel-expired-lease";
          readonly state: "cancelled" | "running" | "terminal" | "no-lease";
          readonly leaseId: string;
          readonly scope: GenerationExecutionScope;
        },
  ): Promise<string>;
  signTerminal(claims: {
    readonly leaseId: string;
    readonly permitJti: string;
    readonly outcome: "completed" | "rejected";
    readonly actualCostMicros: number;
    readonly tenantId: string;
    readonly locationId: string;
    readonly reviewSessionId: string;
    readonly generationBatchId: string;
    readonly generationId: string;
    readonly action: string;
    readonly reviewFormatVersionId: string;
    readonly assertionSetHash: string;
    readonly requestHash: string;
    readonly snapshotId: string;
    readonly snapshotHash: string;
    readonly providerModelId: string;
    readonly priceRateId: string;
    readonly idempotencyKey: string;
  }): Promise<string>;
}

export interface GenerationTerminalStore {
  complete(input: {
    readonly leaseId: string;
    readonly attemptId: string;
    readonly permitJti: string;
    readonly workload: GenerationWorkloadDto;
    readonly result: CompletedPaidWorkAttemptResult;
  }): Promise<{
    readonly draft: ReviewerDraftDto;
    readonly actualCostMicros: number;
  }>;
  reject(input: {
    readonly leaseId: string;
    readonly attemptId: string;
    readonly permitJti: string;
    readonly workload: GenerationWorkloadDto;
    readonly code:
      | "GROUNDING_REJECTED"
      | "POLICY_REJECTED"
      | "FORMAT_REJECTED"
      | "PROVIDER_UNAVAILABLE";
    readonly retryable: boolean;
  }): Promise<{ readonly actualCostMicros: number }>;
}

export interface PaidWorkGenerationHandlerOptions {
  readonly permitVerifier: GenerationPermitVerifier;
  readonly activationVerifier: GenerationActivationVerifier;
  readonly leaseJournal: GenerationLeaseJournal;
  readonly receiptSigner: GenerationReceiptSigner;
  readonly terminalStore: GenerationTerminalStore;
  readonly prepareAttempt: (workload: GenerationWorkloadDto) => Promise<{
    readonly requestPayload: unknown;
    readonly execute: (
      attemptId: string,
    ) => Promise<CompletedPaidWorkAttemptResult>;
  }>;
  readonly tailExisting: (input: {
    readonly attemptId: string;
    readonly leaseId: string;
    readonly permitJti: string;
    readonly workload: GenerationWorkloadDto;
  }) => Promise<unknown>;
  readonly recordDisposition?: ((event: unknown) => Promise<unknown>) | undefined;
}

export function createPaidWorkGenerationHandler({
  permitVerifier,
  activationVerifier,
  leaseJournal,
  receiptSigner,
  terminalStore,
  prepareAttempt,
  tailExisting,
  recordDisposition,
}: PaidWorkGenerationHandlerOptions): (event: unknown) => Promise<unknown> {
  return async (event) => {
    const invocation = GenerationFunctionInvocationDtoSchema.parse(event);
    if (invocation.operation === "record-reviewer-disposition") {
      if (recordDisposition === undefined) {
        throw new Error("GENERATION_OPERATION_NOT_IMPLEMENTED");
      }
      return await recordDisposition(invocation);
    }
    if (invocation.operation === "prepare") {
      const verifiedPermit = await permitVerifier.verify(
        invocation.permit,
        invocation.workload,
      );
      const lease = await leaseJournal.prepare({
        permitJti: verifiedPermit.permitJti,
        permitExpiresAt: verifiedPermit.expiresAt,
        workload: invocation.workload,
      });
      const leaseReceipt = await receiptSigner.signLease({
        permitJti: verifiedPermit.permitJti,
        leaseId: lease.leaseId,
        leaseExpiresAt: lease.leaseExpiresAt,
        ...invocation.workload.bindings,
      });

      return PrepareGenerationResultDtoSchema.parse({
        operation: "prepare",
        status: lease.status,
        leaseId: lease.leaseId,
        leaseExpiresAt: lease.leaseExpiresAt,
        leaseReceipt,
      });
    }

    if (invocation.operation === "execute") {
      const verifiedActivation = await activationVerifier.verify(
        invocation.activation,
        invocation.leaseId,
        invocation.workload,
      );
      const preparedAttempt = await prepareAttempt(invocation.workload);
      const claim = await leaseJournal.claimExecution({
        leaseId: invocation.leaseId,
        permitJti: verifiedActivation.permitJti,
        activationExpiresAt: verifiedActivation.expiresAt,
        attemptOrdinal: 1,
        requestPayload: preparedAttempt.requestPayload,
        workload: invocation.workload,
      });
      const executionInput = {
        attemptId: claim.attemptId,
        leaseId: invocation.leaseId,
        permitJti: verifiedActivation.permitJti,
        workload: invocation.workload,
      };

      if (claim.status === "existing") {
        return await tailExisting(executionInput);
      }

      let result: CompletedPaidWorkAttemptResult;
      try {
        result = await preparedAttempt.execute(claim.attemptId);
      } catch (error) {
        const knownCode =
          error instanceof Error &&
          ["GROUNDING_REJECTED", "POLICY_REJECTED", "FORMAT_REJECTED"].includes(
            Reflect.get(error, "code") as string,
          )
            ? (Reflect.get(error, "code") as
                | "GROUNDING_REJECTED"
                | "POLICY_REJECTED"
                | "FORMAT_REJECTED")
            : undefined;
        const code = knownCode ?? "PROVIDER_UNAVAILABLE";
        const retryable = knownCode === undefined;
        const rejected = await terminalStore.reject({
          ...executionInput,
          code,
          retryable,
        });
        const terminalReceipt = await receiptSigner.signTerminal({
          leaseId: invocation.leaseId,
          permitJti: verifiedActivation.permitJti,
          outcome: "rejected",
          actualCostMicros: rejected.actualCostMicros,
          ...invocation.workload.bindings,
        });
        return PrivateGenerationTerminalEventDtoSchema.parse({
          type: "terminal",
          status: "rejected",
          terminalReceipt,
          code,
          retryable,
        });
      }
      const terminal = await terminalStore.complete({
        leaseId: invocation.leaseId,
        attemptId: claim.attemptId,
        permitJti: verifiedActivation.permitJti,
        workload: invocation.workload,
        result,
      });
      const terminalReceipt = await receiptSigner.signTerminal({
        leaseId: invocation.leaseId,
        permitJti: verifiedActivation.permitJti,
        outcome: "completed",
        actualCostMicros: terminal.actualCostMicros,
        ...invocation.workload.bindings,
      });
      return PrivateGenerationTerminalEventDtoSchema.parse({
        type: "terminal",
        status: "completed",
        terminalReceipt,
        draft: terminal.draft,
      });
    }

    if (invocation.operation === "status") {
      const journalStatus = await leaseJournal.status(invocation.scope);
      const unsigned = {
        operation: invocation.operation,
        state: journalStatus.state,
        scope: invocation.scope,
      };
      const signedStatusReceipt = await receiptSigner.signStatus(unsigned);
      return GenerationStatusResultDtoSchema.parse({
        operation: unsigned.operation,
        state: unsigned.state,
        signedStatusReceipt,
      });
    }

    if (invocation.operation === "cancel-expired-lease") {
      const cancellation = await leaseJournal.cancelExpired({
        leaseId: invocation.leaseId,
        scope: invocation.scope,
      });
      const unsigned = {
        operation: invocation.operation,
        state: cancellation.state,
        leaseId: invocation.leaseId,
        scope: invocation.scope,
      };
      const signedStatusReceipt = await receiptSigner.signStatus(unsigned);
      return CancelExpiredLeaseResultDtoSchema.parse({
        operation: unsigned.operation,
        state: unsigned.state,
        signedStatusReceipt,
      });
    }

    throw new Error("GENERATION_OPERATION_NOT_IMPLEMENTED");
  };
}
