import {
  ActivateGenerationInvocationDtoSchema,
  ActivateGenerationInvocationResultDtoSchema,
  AdvanceEntryInvocationDtoSchema,
  AdvanceEntryInvocationResultDtoSchema,
  type ContextFunctionInvocationDto,
  PrepareEntryInvocationDtoSchema,
  PrepareEntryInvocationResultDtoSchema,
  PrepareReviewerGenerationInvocationDtoSchema,
  PrepareReviewerGenerationInvocationResultDtoSchema,
  ReadEntryChallengeInvocationDtoSchema,
  ReadEntryChallengeInvocationResultDtoSchema,
  ReadReviewSessionInvocationDtoSchema,
  ReadReviewSessionInvocationResultDtoSchema,
  SettleGenerationInvocationDtoSchema,
  SettleGenerationInvocationResultDtoSchema,
} from "@review/contracts/context";

import type { ContextPort } from "../ports/context.port.js";
import type { ReviewerGenerationContextPort } from "../ports/reviewer-generation.port.js";

export interface ContextFunctionInvoker {
  invoke(request: ContextFunctionInvocationDto): Promise<unknown>;
}

export function createInvokedReviewerGenerationContextPort(
  invoker: ContextFunctionInvoker,
): ReviewerGenerationContextPort {
  return {
    async prepare(input) {
      const request = PrepareReviewerGenerationInvocationDtoSchema.parse({
        operation: "prepare-reviewer-generation",
        input,
      });
      const response = PrepareReviewerGenerationInvocationResultDtoSchema.parse(
        await invoker.invoke(request),
      );
      return response.result;
    },

    async activate(input) {
      const request = ActivateGenerationInvocationDtoSchema.parse({
        operation: "activate-generation",
        input,
      });
      const response = ActivateGenerationInvocationResultDtoSchema.parse(
        await invoker.invoke(request),
      );
      return response.result;
    },

    async settle(input) {
      const request = SettleGenerationInvocationDtoSchema.parse({
        operation: "settle-generation",
        input,
      });
      const response = SettleGenerationInvocationResultDtoSchema.parse(
        await invoker.invoke(request),
      );
      return response.result;
    },
  };
}

export function createInvokedContextPort(
  invoker: ContextFunctionInvoker,
): ContextPort {
  return {
    async prepareEntry(input) {
      const request = PrepareEntryInvocationDtoSchema.parse({
        operation: "prepare-entry",
        input,
      });
      const response = PrepareEntryInvocationResultDtoSchema.parse(
        await invoker.invoke(request),
      );
      return response.result;
    },

    async readEntryChallenge(input) {
      const request = ReadEntryChallengeInvocationDtoSchema.parse({
        operation: "read-entry-challenge",
        input,
      });
      const response = ReadEntryChallengeInvocationResultDtoSchema.parse(
        await invoker.invoke(request),
      );
      return response.result;
    },

    async advanceEntry(input) {
      const request = AdvanceEntryInvocationDtoSchema.parse({
        operation: "advance-entry",
        input,
      });
      const response = AdvanceEntryInvocationResultDtoSchema.parse(
        await invoker.invoke(request),
      );
      return response.result;
    },

    async readReviewSession(input) {
      const request = ReadReviewSessionInvocationDtoSchema.parse({
        operation: "read-review-session",
        input,
      });
      const response = ReadReviewSessionInvocationResultDtoSchema.parse(
        await invoker.invoke(request),
      );
      return response.result;
    },
  };
}
