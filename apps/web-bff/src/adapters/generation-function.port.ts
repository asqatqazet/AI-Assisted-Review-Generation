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
  RecordReviewerDispositionInvocationDtoSchema,
  RecordReviewerDispositionResultDtoSchema,
  type GenerationFunctionInvocationDto,
} from "@review/contracts/generation";
import {
  ConsoleBenchInvocationDtoSchema,
  ConsoleBenchInvocationResultDtoSchema,
  type ConsoleBenchInvocationDto,
} from "@review/contracts/console";
import {
  ConsoleReadInvocationDtoSchema,
  ConsoleReadInvocationResultDtoSchema,
  type ConsoleReadInvocationDto,
} from "@review/contracts/console-read";

import type { ReviewerGenerationExecutionPort } from "../ports/reviewer-generation.port.js";
import type { ReviewerDispositionExecutionPort } from "../ports/reviewer-disposition.port.js";
import type { ReconciliationGenerationPort } from "../reconciliation.js";
import type {
  ConsoleBenchExecutionPort,
  ConsoleExecutionReadPort,
} from "../ports/console-execution.port.js";

export interface GenerationFunctionInvoker {
  invoke(
    request:
      | GenerationFunctionInvocationDto
      | ConsoleReadInvocationDto
      | ConsoleBenchInvocationDto,
    options?: { readonly signal?: AbortSignal | undefined },
  ): Promise<unknown>;
}

export function createInvokedConsoleBenchExecutionPort(
  invoker: GenerationFunctionInvoker,
): ConsoleBenchExecutionPort {
  return {
    async execute(input) {
      const request = ConsoleBenchInvocationDtoSchema.parse({
        operation: "console-bench",
        input,
      });
      const response = ConsoleBenchInvocationResultDtoSchema.parse(
        await invoker.invoke(request),
      );
      return response.result;
    },
  };
}

export function createInvokedConsoleExecutionReadPort(
  invoker: GenerationFunctionInvoker,
): ConsoleExecutionReadPort {
  return {
    async read(input) {
      const request = ConsoleReadInvocationDtoSchema.parse({
        operation: "console-read",
        input,
      });
      const response = ConsoleReadInvocationResultDtoSchema.parse(
        await invoker.invoke(request),
      );
      return response.result;
    },
  };
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

export function createInvokedReviewerDispositionExecutionPort(
  invoker: GenerationFunctionInvoker,
): ReviewerDispositionExecutionPort {
  return {
    async record(input) {
      const request = RecordReviewerDispositionInvocationDtoSchema.parse({
        operation: "record-reviewer-disposition",
        ...input,
      });
      const response = RecordReviewerDispositionResultDtoSchema.parse(
        await invoker.invoke(request),
      );
      return {
        status: response.status,
        kind: response.kind,
        revision: response.revision,
        normalizedEditDistance: response.normalizedEditDistance,
      };
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
        permitJti: input.permitJti,
        workload: input.workload,
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
