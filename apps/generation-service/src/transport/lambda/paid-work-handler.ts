import {
  CancelExpiredLeaseResultDtoSchema,
  GenerationFunctionInvocationDtoSchema,
  GenerationStatusResultDtoSchema,
  PrivateGenerationTerminalEventDtoSchema,
  PrepareGenerationResultDtoSchema,
  type CancelExpiredLeaseInvocationDto,
  type GenerationWorkloadDto,
  type ReviewerDraftDto,
} from "@review/contracts/generation";

import type { PaidWorkAttemptResult } from "../../application/paid-work-attempt.js";

type GenerationExecutionScope = CancelExpiredLeaseInvocationDto["scope"];

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
    readonly state:
      | "no-lease"
      | "leased"
      | "running"
      | "indeterminate"
      | "cancelled"
      | "terminal";
  }>;
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
  }>;
}

export interface VerifiedGenerationActivation {
  readonly expiresAt: string;
  readonly permitJti: string;
}

export type GenerationPersistedTerminal = {
  readonly actualCostMicros: number;
} & (
  | { readonly draft: ReviewerDraftDto }
  | {
      readonly rejection: {
        readonly code:
          | "GROUNDING_REJECTED"
          | "POLICY_REJECTED"
          | "FORMAT_REJECTED"
          | "PROVIDER_UNAVAILABLE";
        readonly retryable: boolean;
      };
    }
);

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
            | "indeterminate"
            | "cancelled"
            | "terminal";
          readonly scope: GenerationExecutionScope;
        }
      | {
          readonly operation: "cancel-expired-lease";
          readonly state:
            | "cancelled"
            | "running"
            | "indeterminate"
            | "terminal"
            | "no-lease";
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
  checkpoint(input: {
    readonly leaseId: string;
    readonly attemptId: string;
    readonly permitJti: string;
    readonly workload: GenerationWorkloadDto;
    readonly result: PaidWorkAttemptResult;
  }): Promise<void>;
  complete(input: {
    readonly leaseId: string;
    readonly attemptId: string;
    readonly permitJti: string;
    readonly workload: GenerationWorkloadDto;
  }): Promise<GenerationPersistedTerminal>;
  recover(input: {
    readonly leaseId: string;
    readonly attemptId: string;
    readonly permitJti: string;
    readonly workload: GenerationWorkloadDto;
  }): Promise<
    | { readonly state: "none" | "indeterminate" }
    | {
        readonly state: "completed";
        readonly terminal: GenerationPersistedTerminal;
      }
  >;
  recoverByScope(input: {
    readonly permitJti: string;
    readonly workload: GenerationWorkloadDto;
  }): Promise<
    | { readonly state: "none" | "indeterminate" }
    | {
        readonly state: "completed";
        readonly leaseId: string;
        readonly terminal: GenerationPersistedTerminal;
      }
  >;
  markIndeterminate(input: {
    readonly leaseId: string;
    readonly attemptId: string;
    readonly permitJti: string;
    readonly workload: GenerationWorkloadDto;
    readonly reason: "provider-timeout" | "checkpoint-unavailable";
  }): Promise<
    | { readonly state: "indeterminate" }
    | { readonly state: "checkpointed" }
    | { readonly state: "terminal" }
  >;
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
    ) => Promise<PaidWorkAttemptResult>;
  }>;
  readonly tailExisting: (input: {
    readonly attemptId: string;
    readonly leaseId: string;
    readonly permitJti: string;
    readonly workload: GenerationWorkloadDto;
  }) => Promise<unknown>;
  readonly recordDisposition?: ((event: unknown) => Promise<unknown>) | undefined;
  readonly recordDraftRevision?:
    | ((event: unknown) => Promise<unknown>)
    | undefined;
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
  recordDraftRevision,
}: PaidWorkGenerationHandlerOptions): (event: unknown) => Promise<unknown> {
  const completeCheckpoint = async (input: {
    readonly leaseId: string;
    readonly attemptId: string;
    readonly permitJti: string;
    readonly workload: GenerationWorkloadDto;
  }): Promise<GenerationPersistedTerminal> => {
    let firstFailure: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await terminalStore.complete(input);
      } catch (error) {
        firstFailure ??= error;
      }
    }
    throw firstFailure;
  };

  const projectTerminal = async ({
    terminal,
    leaseId,
    permitJti,
    workload,
  }: {
    readonly terminal: GenerationPersistedTerminal;
    readonly leaseId: string;
    readonly permitJti: string;
    readonly workload: GenerationWorkloadDto;
  }): Promise<unknown> => {
    const outcome = "draft" in terminal ? "completed" : "rejected";
    const terminalReceipt = await receiptSigner.signTerminal({
      leaseId,
      permitJti,
      outcome,
      actualCostMicros: terminal.actualCostMicros,
      ...workload.bindings,
    });
    return PrivateGenerationTerminalEventDtoSchema.parse(
      "draft" in terminal
        ? {
            type: "terminal",
            status: "completed",
            terminalReceipt,
            draft: terminal.draft,
          }
        : {
            type: "terminal",
            status: "rejected",
            terminalReceipt,
            code: terminal.rejection.code,
            retryable: terminal.rejection.retryable,
          },
    );
  };

  const executionScope = (
    workload: GenerationWorkloadDto,
    permitJti: string,
  ): GenerationExecutionScope => ({
    tenantId: workload.bindings.tenantId,
    locationId: workload.bindings.locationId,
    reviewSessionId: workload.bindings.reviewSessionId,
    generationBatchId: workload.bindings.generationBatchId,
    generationId: workload.bindings.generationId,
    permitJti,
  });

  const terminalStatus = async ({
    terminal,
    leaseId,
    permitJti,
    workload,
  }: {
    readonly terminal: GenerationPersistedTerminal;
    readonly leaseId: string;
    readonly permitJti: string;
    readonly workload: GenerationWorkloadDto;
  }): Promise<unknown> => {
    const terminalReceipt = await receiptSigner.signTerminal({
      leaseId,
      permitJti,
      outcome: "draft" in terminal ? "completed" : "rejected",
      actualCostMicros: terminal.actualCostMicros,
      ...workload.bindings,
    });
    return GenerationStatusResultDtoSchema.parse({
      operation: "status",
      state: "terminal",
      terminalReceipt,
    });
  };

  return async (event) => {
    const invocation = GenerationFunctionInvocationDtoSchema.parse(event);
    if (invocation.operation === "record-reviewer-disposition") {
      if (recordDisposition === undefined) {
        throw new Error("GENERATION_OPERATION_NOT_IMPLEMENTED");
      }
      return await recordDisposition(invocation);
    }
    if (invocation.operation === "record-reviewer-draft-revision") {
      if (recordDraftRevision === undefined) {
        throw new Error("GENERATION_OPERATION_NOT_IMPLEMENTED");
      }
      return await recordDraftRevision(invocation);
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
        const recovered = await terminalStore.recover(executionInput);
        if (recovered.state === "indeterminate") {
          throw new Error("PROVIDER_RESULT_INDETERMINATE");
        }
        if (recovered.state === "completed") {
          return await projectTerminal({
            terminal: recovered.terminal,
            leaseId: invocation.leaseId,
            permitJti: verifiedActivation.permitJti,
            workload: invocation.workload,
          });
        }
        return await tailExisting(executionInput);
      }

      let result: PaidWorkAttemptResult;
      try {
        result = await preparedAttempt.execute(claim.attemptId);
      } catch (error) {
        if (error instanceof Error && Reflect.get(error, "code") === "timeout") {
          const marked = await terminalStore.markIndeterminate({
            ...executionInput,
            reason: "provider-timeout",
          });
          if (marked.state !== "indeterminate") {
            const recovered = await terminalStore.recover(executionInput);
            if (recovered.state === "completed") {
              return await projectTerminal({
                terminal: recovered.terminal,
                leaseId: invocation.leaseId,
                permitJti: verifiedActivation.permitJti,
                workload: invocation.workload,
              });
            }
          }
          throw new Error("PROVIDER_RESULT_INDETERMINATE", { cause: error });
        }
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
      let checkpointFailure: unknown;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          await terminalStore.checkpoint({
            ...executionInput,
            result,
          });
          checkpointFailure = undefined;
          break;
        } catch (error) {
          checkpointFailure = error;
        }
      }
      if (checkpointFailure !== undefined) {
        let recoveredAfterFailure:
          | Awaited<ReturnType<GenerationTerminalStore["recover"]>>
          | undefined;
        try {
          recoveredAfterFailure = await terminalStore.recover(executionInput);
        } catch {
          // A failed read cannot distinguish an absent checkpoint from a
          // committed checkpoint whose acknowledgement was lost.
        }
        if (recoveredAfterFailure?.state === "completed") {
          return await projectTerminal({
            terminal: recoveredAfterFailure.terminal,
            leaseId: invocation.leaseId,
            permitJti: verifiedActivation.permitJti,
            workload: invocation.workload,
          });
        }
        if (recoveredAfterFailure?.state === "indeterminate") {
          throw new Error("PROVIDER_RESULT_INDETERMINATE", {
            cause: checkpointFailure,
          });
        }

        try {
          const marked = await terminalStore.markIndeterminate({
            ...executionInput,
            reason: "checkpoint-unavailable",
          });
          if (marked.state !== "indeterminate") {
            const recovered = await terminalStore.recover(executionInput);
            if (recovered.state === "completed") {
              return await projectTerminal({
                terminal: recovered.terminal,
                leaseId: invocation.leaseId,
                permitJti: verifiedActivation.permitJti,
                workload: invocation.workload,
              });
            }
            if (recovered.state !== "indeterminate") {
              throw new Error("PROVIDER_RESULT_CHECKPOINT_UNAVAILABLE");
            }
          }
        } catch (markError) {
          let racedRecovery:
            | Awaited<ReturnType<GenerationTerminalStore["recover"]>>
            | undefined;
          try {
            racedRecovery = await terminalStore.recover(executionInput);
          } catch {
            throw new Error("PROVIDER_RESULT_CHECKPOINT_UNAVAILABLE", {
              cause: markError,
            });
          }
          if (racedRecovery.state === "completed") {
            return await projectTerminal({
              terminal: racedRecovery.terminal,
              leaseId: invocation.leaseId,
              permitJti: verifiedActivation.permitJti,
              workload: invocation.workload,
            });
          }
          if (racedRecovery.state !== "indeterminate") {
            throw new Error("PROVIDER_RESULT_CHECKPOINT_UNAVAILABLE", {
              cause: markError,
            });
          }
        }
        throw new Error("PROVIDER_RESULT_INDETERMINATE", {
          cause: checkpointFailure,
        });
      }
      const terminal = await completeCheckpoint({
        leaseId: invocation.leaseId,
        attemptId: claim.attemptId,
        permitJti: verifiedActivation.permitJti,
        workload: invocation.workload,
      });
      return await projectTerminal({
        terminal,
        leaseId: invocation.leaseId,
        permitJti: verifiedActivation.permitJti,
        workload: invocation.workload,
      });
    }

    if (invocation.operation === "status") {
      const scope = executionScope(invocation.workload, invocation.permitJti);
      const recovered = await terminalStore.recoverByScope({
        permitJti: invocation.permitJti,
        workload: invocation.workload,
      });
      if (recovered.state === "completed") {
        return await terminalStatus({
          terminal: recovered.terminal,
          leaseId: recovered.leaseId,
          permitJti: invocation.permitJti,
          workload: invocation.workload,
        });
      }
      const journalStatus =
        recovered.state === "indeterminate"
          ? ({ state: "indeterminate" } as const)
          : await leaseJournal.status(scope);
      if (journalStatus.state === "terminal") {
        const raced = await terminalStore.recoverByScope({
          permitJti: invocation.permitJti,
          workload: invocation.workload,
        });
        if (raced.state === "completed") {
          return await terminalStatus({
            terminal: raced.terminal,
            leaseId: raced.leaseId,
            permitJti: invocation.permitJti,
            workload: invocation.workload,
          });
        }
        throw new Error("GENERATION_TERMINAL_NOT_AVAILABLE");
      }
      const unsigned = {
        operation: invocation.operation,
        state: journalStatus.state,
        scope,
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
