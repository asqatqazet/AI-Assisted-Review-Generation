import {
  AdvanceEntryInvocationResultDtoSchema,
  ContextFunctionInvocationDtoSchema,
  PrepareEntryInvocationResultDtoSchema,
  ReadEntryChallengeInvocationResultDtoSchema,
  type AdvanceEntryInvocationDto,
  type AdvanceEntryInvocationResultDto,
  type ContextFunctionInvocationDto,
  type PrepareEntryInvocationDto,
  type PrepareEntryInvocationResultDto,
  type ReadEntryChallengeInvocationDto,
  type ReadEntryChallengeInvocationResultDto,
} from "@review/contracts/context";

export interface ContextEntryService {
  prepareEntry(
    input: PrepareEntryInvocationDto["input"],
  ): Promise<PrepareEntryInvocationResultDto["result"]>;
  readEntryChallenge(
    input: ReadEntryChallengeInvocationDto["input"],
  ): Promise<ReadEntryChallengeInvocationResultDto["result"]>;
  advanceEntry(
    input: AdvanceEntryInvocationDto["input"],
  ): Promise<AdvanceEntryInvocationResultDto["result"]>;
}

export interface ContextFunctionOptions {
  readonly entryService: ContextEntryService;
}

export function createContextFunctionHandler({
  entryService,
}: ContextFunctionOptions): (
  event: unknown,
) => Promise<
  | PrepareEntryInvocationResultDto
  | ReadEntryChallengeInvocationResultDto
  | AdvanceEntryInvocationResultDto
> {
  return async (event) => {
    const invocation: ContextFunctionInvocationDto =
      ContextFunctionInvocationDtoSchema.parse(event);

    switch (invocation.operation) {
      case "prepare-entry":
        return PrepareEntryInvocationResultDtoSchema.parse({
          operation: invocation.operation,
          result: await entryService.prepareEntry(invocation.input),
        });
      case "read-entry-challenge":
        return ReadEntryChallengeInvocationResultDtoSchema.parse({
          operation: invocation.operation,
          result: await entryService.readEntryChallenge(invocation.input),
        });
      case "advance-entry":
        return AdvanceEntryInvocationResultDtoSchema.parse({
          operation: invocation.operation,
          result: await entryService.advanceEntry(invocation.input),
        });
    }
  };
}
