import {
  CancelExpiredLeaseInvocationDtoSchema,
  CancelExpiredLeaseResultDtoSchema,
  ExecuteGenerationInvocationDtoSchema,
  GenerationFunctionInvocationDtoSchema,
  GenerationStatusInvocationDtoSchema,
  GenerationStatusResultDtoSchema,
  PrepareGenerationInvocationDtoSchema,
  PrepareGenerationResultDtoSchema,
  PrivateGenerationTerminalEventDtoSchema,
  type GenerationFunctionInvocationDto,
} from "@review/contracts/generation";

import type { ReviewerGenerationExecutionPort } from "../ports/reviewer-generation.port.js";
import type { ReconciliationGenerationPort } from "../reconciliation.js";

export interface GenerationFunctionInvoker {
  invoke(
    request: GenerationFunctionInvocationDto,
    options?: { readonly signal?: AbortSignal | undefined },
  ): Promise<unknown>;
}

const wait = async (milliseconds: number, signal: AbortSignal): Promise<void> =>
  await new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new Error("GENERATION_CANCELLED"));
      return;
    }
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", cancel);
      resolve();
    }, milliseconds);
    const cancel = (): void => {
      clearTimeout(timeout);
      reject(signal.reason ?? new Error("GENERATION_CANCELLED"));
    };
    signal.addEventListener("abort", cancel, { once: true });
  });

export function createInvokedReviewerGenerationExecutionPort(
  invoker: GenerationFunctionInvoker,
  { heartbeatMs = 10_000 }: { readonly heartbeatMs?: number } = {},
): ReviewerGenerationExecutionPort {
  if (!Number.isInteger(heartbeatMs) || heartbeatMs < 1) {
    throw new Error("heartbeatMs must be a positive integer");
  }

  return {
    async prepare(input) {
      const request = PrepareGenerationInvocationDtoSchema.parse({
        operation: "prepare",
        permit: input.permit,
        workload: input.workload,
      });
      const response = PrepareGenerationResultDtoSchema.parse(
        await invoker.invoke(request),
      );
      return {
        leaseId: response.leaseId,
        leaseReceipt: response.leaseReceipt,
      };
    },

    async *execute(input) {
      const request = ExecuteGenerationInvocationDtoSchema.parse({
        operation: "execute",
        leaseId: input.leaseId,
        activation: input.activation,
        workload: input.workload,
      });
      const startedAt = Date.now();
      const invocation = invoker
        .invoke(GenerationFunctionInvocationDtoSchema.parse(request), {
          signal: input.signal,
        })
        .then((value) => ({ kind: "terminal" as const, value }));

      yield { type: "progress", phase: "generating", elapsedSeconds: 0 };
      while (true) {
        const outcome = await Promise.race([
          invocation,
          wait(heartbeatMs, input.signal).then(() => ({
            kind: "heartbeat" as const,
          })),
        ]);
        if (outcome.kind === "terminal") {
          yield PrivateGenerationTerminalEventDtoSchema.parse(outcome.value);
          return;
        }
        yield {
          type: "heartbeat",
          elapsedSeconds: Math.floor((Date.now() - startedAt) / 1_000),
        };
      }
    },
  };
}

export function createInvokedReconciliationGenerationPort(
  invoker: GenerationFunctionInvoker,
): ReconciliationGenerationPort {
  return {
    async status(input) {
      const request = GenerationStatusInvocationDtoSchema.parse({
        operation: "status",
        scope: input.scope,
      });
      return GenerationStatusResultDtoSchema.parse(
        await invoker.invoke(
          GenerationFunctionInvocationDtoSchema.parse(request),
        ),
      );
    },

    async cancelExpired(input) {
      const request = CancelExpiredLeaseInvocationDtoSchema.parse({
        operation: "cancel-expired-lease",
        leaseId: input.leaseId,
        scope: input.scope,
      });
      return CancelExpiredLeaseResultDtoSchema.parse(
        await invoker.invoke(
          GenerationFunctionInvocationDtoSchema.parse(request),
        ),
      );
    },
  };
}
