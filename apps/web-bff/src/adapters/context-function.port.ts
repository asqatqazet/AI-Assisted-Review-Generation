import {
  AdvanceEntryInvocationDtoSchema,
  AdvanceEntryInvocationResultDtoSchema,
  type ContextFunctionInvocationDto,
  PrepareEntryInvocationDtoSchema,
  PrepareEntryInvocationResultDtoSchema,
  ReadEntryChallengeInvocationDtoSchema,
  ReadEntryChallengeInvocationResultDtoSchema,
} from "@review/contracts/context";

import type { ContextPort } from "../ports/context.port.js";

export interface ContextFunctionInvoker {
  invoke(request: ContextFunctionInvocationDto): Promise<unknown>;
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
  };
}
