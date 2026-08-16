import {
  GenerationFunctionInvocationDtoSchema,
  PrepareGenerationResultDtoSchema,
  type GenerationWorkloadDto,
} from "@review/contracts/generation";

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
    readonly idempotencyKey: string;
  }): Promise<string>;
}

export interface PaidWorkGenerationHandlerOptions {
  readonly permitVerifier: GenerationPermitVerifier;
  readonly leaseJournal: GenerationLeaseJournal;
  readonly receiptSigner: GenerationReceiptSigner;
  readonly execute: (invocation: unknown) => Promise<void>;
}

export function createPaidWorkGenerationHandler({
  permitVerifier,
  leaseJournal,
  receiptSigner,
}: PaidWorkGenerationHandlerOptions): (event: unknown) => Promise<unknown> {
  return async (event) => {
    const invocation = GenerationFunctionInvocationDtoSchema.parse(event);
    if (invocation.operation !== "prepare") {
      throw new Error("GENERATION_OPERATION_NOT_IMPLEMENTED");
    }

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
  };
}
