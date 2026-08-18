import {
  ActivateGenerationInvocationResultDtoSchema,
  AdvanceEntryInvocationResultDtoSchema,
  ContextFunctionInvocationDtoSchema,
  ListReconciliationCandidatesInvocationResultDtoSchema,
  PrepareEntryInvocationResultDtoSchema,
  PrepareReviewerDispositionInvocationResultDtoSchema,
  PrepareReviewerGenerationInvocationResultDtoSchema,
  ReadEntryChallengeInvocationResultDtoSchema,
  ReadReviewSessionInvocationResultDtoSchema,
  ReleaseReconciledGenerationInvocationResultDtoSchema,
  SettleGenerationInvocationResultDtoSchema,
  type ActivateGenerationInvocationDto,
  type ActivateGenerationInvocationResultDto,
  type AdvanceEntryInvocationDto,
  type AdvanceEntryInvocationResultDto,
  type ContextFunctionInvocationDto,
  type ListReconciliationCandidatesInvocationDto,
  type ListReconciliationCandidatesInvocationResultDto,
  type PrepareEntryInvocationDto,
  type PrepareEntryInvocationResultDto,
  type PrepareReviewerDispositionInvocationDto,
  type PrepareReviewerDispositionInvocationResultDto,
  type PrepareReviewerGenerationInvocationDto,
  type PrepareReviewerGenerationInvocationResultDto,
  type ReadEntryChallengeInvocationDto,
  type ReadEntryChallengeInvocationResultDto,
  type ReadReviewSessionInvocationDto,
  type ReadReviewSessionInvocationResultDto,
  type ReleaseReconciledGenerationInvocationDto,
  type ReleaseReconciledGenerationInvocationResultDto,
  type SettleGenerationInvocationDto,
  type SettleGenerationInvocationResultDto,
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
  readReviewSession(
    input: ReadReviewSessionInvocationDto["input"],
  ): Promise<ReadReviewSessionInvocationResultDto["result"]>;
  prepareReviewerDisposition(
    input: PrepareReviewerDispositionInvocationDto["input"],
  ): Promise<PrepareReviewerDispositionInvocationResultDto["result"]>;
  prepareReviewerGeneration(
    input: PrepareReviewerGenerationInvocationDto["input"],
  ): Promise<PrepareReviewerGenerationInvocationResultDto["result"]>;
  activateGeneration(
    input: ActivateGenerationInvocationDto["input"],
  ): Promise<ActivateGenerationInvocationResultDto["result"]>;
  settleGeneration(
    input: SettleGenerationInvocationDto["input"],
  ): Promise<SettleGenerationInvocationResultDto["result"]>;
  listReconciliationCandidates(
    input: ListReconciliationCandidatesInvocationDto["input"],
  ): Promise<ListReconciliationCandidatesInvocationResultDto["result"]>;
  releaseReconciledGeneration(
    input: ReleaseReconciledGenerationInvocationDto["input"],
  ): Promise<ReleaseReconciledGenerationInvocationResultDto["result"]>;
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
  | ReadReviewSessionInvocationResultDto
  | PrepareReviewerDispositionInvocationResultDto
  | PrepareReviewerGenerationInvocationResultDto
  | ActivateGenerationInvocationResultDto
  | SettleGenerationInvocationResultDto
  | ListReconciliationCandidatesInvocationResultDto
  | ReleaseReconciledGenerationInvocationResultDto
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
      case "read-review-session":
        return ReadReviewSessionInvocationResultDtoSchema.parse({
          operation: invocation.operation,
          result: await entryService.readReviewSession(invocation.input),
        });
      case "prepare-reviewer-disposition":
        return PrepareReviewerDispositionInvocationResultDtoSchema.parse({
          operation: invocation.operation,
          result: await entryService.prepareReviewerDisposition(invocation.input),
        });
      case "prepare-reviewer-generation":
        return PrepareReviewerGenerationInvocationResultDtoSchema.parse({
          operation: invocation.operation,
          result: await entryService.prepareReviewerGeneration(invocation.input),
        });
      case "activate-generation":
        return ActivateGenerationInvocationResultDtoSchema.parse({
          operation: invocation.operation,
          result: await entryService.activateGeneration(invocation.input),
        });
      case "settle-generation":
        return SettleGenerationInvocationResultDtoSchema.parse({
          operation: invocation.operation,
          result: await entryService.settleGeneration(invocation.input),
        });
      case "list-reconciliation-candidates":
        return ListReconciliationCandidatesInvocationResultDtoSchema.parse({
          operation: invocation.operation,
          result: await entryService.listReconciliationCandidates(
            invocation.input,
          ),
        });
      case "release-reconciled-generation":
        return ReleaseReconciledGenerationInvocationResultDtoSchema.parse({
          operation: invocation.operation,
          result: await entryService.releaseReconciledGeneration(
            invocation.input,
          ),
        });
    }
  };
}
