import {
  ActivateGenerationInvocationResultDtoSchema,
  AdvanceEntryInvocationResultDtoSchema,
  ConsumePublicSourceRateLimitInvocationResultDtoSchema,
  ContextFunctionInvocationDtoSchema,
  ForgetReviewSessionInvocationResultDtoSchema,
  ListReconciliationCandidatesInvocationResultDtoSchema,
  PrepareEntryInvocationResultDtoSchema,
  PrepareReviewerDraftRevisionInvocationResultDtoSchema,
  PrepareReviewerDispositionInvocationResultDtoSchema,
  PrepareReviewerGenerationInvocationResultDtoSchema,
  ReadEntryChallengeInvocationResultDtoSchema,
  ReadReviewSessionInvocationResultDtoSchema,
  SaveReviewSessionProgressInvocationResultDtoSchema,
  ReleaseReconciledGenerationInvocationResultDtoSchema,
  ResolveOperatorAccessInvocationResultDtoSchema,
  SettleGenerationInvocationResultDtoSchema,
  VerifyEntryInvocationResultDtoSchema,
  type ActivateGenerationInvocationDto,
  type ActivateGenerationInvocationResultDto,
  type AdvanceEntryInvocationDto,
  type AdvanceEntryInvocationResultDto,
  type ConsumePublicSourceRateLimitInvocationDto,
  type ConsumePublicSourceRateLimitInvocationResultDto,
  type ContextFunctionInvocationDto,
  type ForgetReviewSessionInvocationDto,
  type ForgetReviewSessionInvocationResultDto,
  type ListReconciliationCandidatesInvocationDto,
  type ListReconciliationCandidatesInvocationResultDto,
  type PrepareEntryInvocationDto,
  type PrepareEntryInvocationResultDto,
  type PrepareReviewerDraftRevisionInvocationDto,
  type PrepareReviewerDraftRevisionInvocationResultDto,
  type PrepareReviewerDispositionInvocationDto,
  type PrepareReviewerDispositionInvocationResultDto,
  type PrepareReviewerGenerationInvocationDto,
  type PrepareReviewerGenerationInvocationResultDto,
  type ReadEntryChallengeInvocationDto,
  type ReadEntryChallengeInvocationResultDto,
  type ReadReviewSessionInvocationDto,
  type ReadReviewSessionInvocationResultDto,
  type SaveReviewSessionProgressInvocationDto,
  type SaveReviewSessionProgressInvocationResultDto,
  type ReleaseReconciledGenerationInvocationDto,
  type ReleaseReconciledGenerationInvocationResultDto,
  type ResolveOperatorAccessInvocationDto,
  type ResolveOperatorAccessInvocationResultDto,
  type SettleGenerationInvocationDto,
  type SettleGenerationInvocationResultDto,
  type VerifyEntryInvocationDto,
  type VerifyEntryInvocationResultDto,
} from "@review/contracts/context";
import {
  AuthorizeConsoleBenchInvocationResultDtoSchema,
  AuthorizeConsoleReadInvocationResultDtoSchema,
  ConsoleRequestInvocationResultDtoSchema,
  type AuthorizeConsoleBenchInvocationDto,
  type AuthorizeConsoleBenchInvocationResultDto,
  type AuthorizeConsoleReadInvocationDto,
  type AuthorizeConsoleReadInvocationResultDto,
  type ConsoleRequestInvocationDto,
  type ConsoleRequestInvocationResultDto,
} from "@review/contracts/console";

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
  verifyEntry(
    input: VerifyEntryInvocationDto["input"],
  ): Promise<VerifyEntryInvocationResultDto["result"]>;
  readReviewSession(
    input: ReadReviewSessionInvocationDto["input"],
  ): Promise<ReadReviewSessionInvocationResultDto["result"]>;
  saveReviewSessionProgress?(
    input: SaveReviewSessionProgressInvocationDto["input"],
  ): Promise<SaveReviewSessionProgressInvocationResultDto["result"]>;
  forgetReviewSession?(
    input: ForgetReviewSessionInvocationDto["input"],
  ): Promise<ForgetReviewSessionInvocationResultDto["result"]>;
  prepareReviewerDraftRevision?(
    input: PrepareReviewerDraftRevisionInvocationDto["input"],
  ): Promise<PrepareReviewerDraftRevisionInvocationResultDto["result"]>;
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
  readonly publicSourceRateLimiter?: ContextPublicSourceRateLimiter | undefined;
  readonly operatorService?: ContextOperatorService | undefined;
  readonly consoleService?: ContextConsoleService | undefined;
  readonly consoleBenchAuthorizer?: ContextConsoleBenchAuthorizer | undefined;
}

export interface ContextPublicSourceRateLimiter {
  consume(
    input: ConsumePublicSourceRateLimitInvocationDto["input"],
  ): Promise<ConsumePublicSourceRateLimitInvocationResultDto["result"]>;
}

export interface ContextConsoleBenchAuthorizer {
  authorize(
    input: AuthorizeConsoleBenchInvocationDto["input"],
  ): Promise<AuthorizeConsoleBenchInvocationResultDto["result"]>;
}

export interface ContextConsoleService {
  request(
    input: ConsoleRequestInvocationDto["input"],
  ): Promise<ConsoleRequestInvocationResultDto["result"]>;
  authorizeRead(
    input: AuthorizeConsoleReadInvocationDto["input"],
  ): Promise<AuthorizeConsoleReadInvocationResultDto["result"]>;
}

export interface ContextOperatorService {
  resolveAccess(
    input: ResolveOperatorAccessInvocationDto["input"],
  ): Promise<ResolveOperatorAccessInvocationResultDto["result"]>;
}

export function createContextFunctionHandler({
  entryService,
  publicSourceRateLimiter,
  operatorService,
  consoleService,
  consoleBenchAuthorizer,
}: ContextFunctionOptions): (
  event: unknown,
) => Promise<
  | PrepareEntryInvocationResultDto
  | ReadEntryChallengeInvocationResultDto
  | AdvanceEntryInvocationResultDto
  | VerifyEntryInvocationResultDto
  | ReadReviewSessionInvocationResultDto
  | SaveReviewSessionProgressInvocationResultDto
  | ForgetReviewSessionInvocationResultDto
  | PrepareReviewerDraftRevisionInvocationResultDto
  | PrepareReviewerDispositionInvocationResultDto
  | PrepareReviewerGenerationInvocationResultDto
  | ActivateGenerationInvocationResultDto
  | SettleGenerationInvocationResultDto
  | ListReconciliationCandidatesInvocationResultDto
  | ReleaseReconciledGenerationInvocationResultDto
  | ConsumePublicSourceRateLimitInvocationResultDto
  | ResolveOperatorAccessInvocationResultDto
  | AuthorizeConsoleReadInvocationResultDto
  | AuthorizeConsoleBenchInvocationResultDto
  | ConsoleRequestInvocationResultDto
> {
  return async (event) => {
    const invocation: ContextFunctionInvocationDto =
      ContextFunctionInvocationDtoSchema.parse(event);

    switch (invocation.operation) {
      case "consume-public-source-rate-limit":
        return ConsumePublicSourceRateLimitInvocationResultDtoSchema.parse({
          operation: invocation.operation,
          result:
            publicSourceRateLimiter === undefined
              ? { status: "limited", retryAfterSeconds: 60 }
              : await publicSourceRateLimiter.consume(invocation.input),
        });
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
      case "verify-entry":
        return VerifyEntryInvocationResultDtoSchema.parse({
          operation: invocation.operation,
          result: await entryService.verifyEntry(invocation.input),
        });
      case "read-review-session":
        return ReadReviewSessionInvocationResultDtoSchema.parse({
          operation: invocation.operation,
          result: await entryService.readReviewSession(invocation.input),
        });
      case "save-review-session-progress":
        return SaveReviewSessionProgressInvocationResultDtoSchema.parse({
          operation: invocation.operation,
          result:
            entryService.saveReviewSessionProgress === undefined
              ? { status: "unavailable" }
              : await entryService.saveReviewSessionProgress(invocation.input),
        });
      case "forget-review-session":
        return ForgetReviewSessionInvocationResultDtoSchema.parse({
          operation: invocation.operation,
          result:
            entryService.forgetReviewSession === undefined
              ? { status: "unavailable" }
              : await entryService.forgetReviewSession(invocation.input),
        });
      case "prepare-reviewer-draft-revision":
        return PrepareReviewerDraftRevisionInvocationResultDtoSchema.parse({
          operation: invocation.operation,
          result:
            entryService.prepareReviewerDraftRevision === undefined
              ? { status: "rejected" }
              : await entryService.prepareReviewerDraftRevision(invocation.input),
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
      case "resolve-operator-access":
        return ResolveOperatorAccessInvocationResultDtoSchema.parse({
          operation: invocation.operation,
          result:
            operatorService === undefined
              ? { status: "unauthorized" }
              : await operatorService.resolveAccess(invocation.input),
        });
      case "console-request":
        return ConsoleRequestInvocationResultDtoSchema.parse({
          operation: invocation.operation,
          result:
            consoleService === undefined
              ? { status: "not-found" }
              : await consoleService.request(invocation.input),
        });
      case "authorize-console-read":
        return AuthorizeConsoleReadInvocationResultDtoSchema.parse({
          operation: invocation.operation,
          result:
            consoleService === undefined
              ? { status: "unavailable" }
              : await consoleService.authorizeRead(invocation.input),
        });
      case "authorize-console-bench":
        return AuthorizeConsoleBenchInvocationResultDtoSchema.parse({
          operation: invocation.operation,
          result:
            consoleBenchAuthorizer === undefined
              ? { status: "unavailable" }
              : await consoleBenchAuthorizer.authorize(invocation.input),
        });
    }
  };
}
