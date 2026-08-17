import {
  CancelExpiredLeaseResultDtoSchema,
  GenerationFunctionInvocationDtoSchema,
  GenerationStatusResultDtoSchema,
  PrepareGenerationResultDtoSchema,
  type GenerationStatusInvocationDto,
  type GenerationWorkloadDto,
} from "@review/contracts/generation";

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
        }
      | {
          readonly operation: "cancel-expired-lease";
          readonly state: "cancelled" | "running" | "terminal" | "no-lease";
        },
  ): Promise<string>;
}

export interface PaidWorkGenerationHandlerOptions {
  readonly permitVerifier: GenerationPermitVerifier;
  readonly activationVerifier: GenerationActivationVerifier;
  readonly leaseJournal: GenerationLeaseJournal;
  readonly receiptSigner: GenerationReceiptSigner;
  readonly prepareAttempt: (workload: GenerationWorkloadDto) => Promise<{
    readonly requestPayload: unknown;
    readonly execute: (attemptId: string) => Promise<unknown>;
  }>;
  readonly tailExisting: (input: {
    readonly attemptId: string;
    readonly workload: GenerationWorkloadDto;
  }) => Promise<unknown>;
}

export function createPaidWorkGenerationHandler({
  permitVerifier,
  activationVerifier,
  leaseJournal,
  receiptSigner,
  prepareAttempt,
  tailExisting,
}: PaidWorkGenerationHandlerOptions): (event: unknown) => Promise<unknown> {
  return async (event) => {
    const invocation = GenerationFunctionInvocationDtoSchema.parse(event);
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
        workload: invocation.workload,
      };

      return claim.status === "claimed"
        ? await preparedAttempt.execute(claim.attemptId)
        : await tailExisting(executionInput);
    }

    if (invocation.operation === "status") {
      const journalStatus = await leaseJournal.status(invocation.scope);
      const unsigned = { operation: invocation.operation, state: journalStatus.state };
      const signedStatusReceipt = await receiptSigner.signStatus(unsigned);
      return GenerationStatusResultDtoSchema.parse({
        ...unsigned,
        signedStatusReceipt,
      });
    }

    if (invocation.operation === "cancel-expired-lease") {
      const cancellation = await leaseJournal.cancelExpired({
        leaseId: invocation.leaseId,
        scope: invocation.scope,
      });
      const unsigned = { operation: invocation.operation, state: cancellation.state };
      const signedStatusReceipt = await receiptSigner.signStatus(unsigned);
      return CancelExpiredLeaseResultDtoSchema.parse({
        ...unsigned,
        signedStatusReceipt,
      });
    }

    throw new Error("GENERATION_OPERATION_NOT_IMPLEMENTED");
  };
}
