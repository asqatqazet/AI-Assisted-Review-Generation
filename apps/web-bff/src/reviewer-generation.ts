import {
  ReviewerGenerationEventDtoSchema,
  type ReviewerGenerationCommandDto,
  type ReviewerGenerationEventDto,
} from "@review/contracts/generation";

import type {
  ReviewerGenerationContextPort,
  ReviewerGenerationExecutionPort,
} from "./ports/reviewer-generation.port.js";

export interface ReviewerGenerationCoordinator {
  start(input: {
    readonly reviewSessionHandle: string;
    readonly browserCapability: string;
    readonly idempotencyKey: string;
    readonly command: ReviewerGenerationCommandDto;
    readonly signal: AbortSignal;
  }): AsyncIterable<ReviewerGenerationEventDto>;
}

const unavailableEvent = (): ReviewerGenerationEventDto => ({
  type: "terminal",
  status: "rejected",
  code: "GENERATION_FAILED",
  retryable: true,
});

export function createReviewerGenerationCoordinator(
  context: ReviewerGenerationContextPort,
  generation: ReviewerGenerationExecutionPort,
): ReviewerGenerationCoordinator {
  return {
    async *start(input) {
      try {
        const prepared = await context.prepare({
          reviewSessionHandle: input.reviewSessionHandle,
          browserCapability: input.browserCapability,
          idempotencyKey: input.idempotencyKey,
          command: input.command,
        });
        if (prepared.status === "rejected") {
          yield ReviewerGenerationEventDtoSchema.parse({
            type: "terminal",
            status: "rejected",
            code: prepared.code,
            retryable: prepared.retryable,
          });
          return;
        }

        const lease = await generation.prepare({
          permit: prepared.permit,
          workload: prepared.workload,
        });
        const activation = await context.activate({
          leaseId: lease.leaseId,
          leaseReceipt: lease.leaseReceipt,
          workload: prepared.workload,
        });
        if (activation.status !== "activated") {
          yield unavailableEvent();
          return;
        }

        yield ReviewerGenerationEventDtoSchema.parse({ type: "accepted" });
        for await (const event of generation.execute({
          leaseId: lease.leaseId,
          activation: activation.activation,
          workload: prepared.workload,
          signal: input.signal,
        })) {
          if (event.type !== "terminal") {
            yield ReviewerGenerationEventDtoSchema.parse(event);
            continue;
          }

          const settlement = await context.settle({
            terminalReceipt: event.terminalReceipt,
            workload: prepared.workload,
          });
          if (settlement.status !== "settled") {
            yield unavailableEvent();
            return;
          }

          yield ReviewerGenerationEventDtoSchema.parse(
            event.status === "completed"
              ? {
                  type: event.type,
                  status: event.status,
                  draft: event.draft,
                }
              : {
                  type: event.type,
                  status: event.status,
                  code: event.code,
                  retryable: event.retryable,
                },
          );
          return;
        }

        yield unavailableEvent();
      } catch {
        yield unavailableEvent();
      }
    },
  };
}
