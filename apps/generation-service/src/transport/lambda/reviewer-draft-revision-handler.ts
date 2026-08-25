import {
  RecordReviewerDraftRevisionInvocationDtoSchema,
  RecordReviewerDraftRevisionResultDtoSchema,
  type ReviewerDraftRevisionScopeDto,
} from "@review/contracts/generation";

export interface ReviewerDraftRevisionPermitVerifier {
  verifyDraftRevisionPermit(
    permit: string,
    scope: ReviewerDraftRevisionScopeDto,
    text: string,
  ): Promise<{ readonly permitJti: string }>;
}

export interface ReviewerDraftRevisionStore {
  saveRevision(input: ReviewerDraftRevisionScopeDto & {
    readonly permitJti: string;
    readonly text: string;
  }): Promise<{
    readonly status: "recorded" | "conflict";
    readonly revision: number;
  }>;
}

export function createReviewerDraftRevisionHandler({
  verifier,
  store,
}: {
  readonly verifier: ReviewerDraftRevisionPermitVerifier;
  readonly store: ReviewerDraftRevisionStore;
}): (event: unknown) => Promise<unknown> {
  return async (event) => {
    const invocation = RecordReviewerDraftRevisionInvocationDtoSchema.parse(event);
    const verified = await verifier.verifyDraftRevisionPermit(
      invocation.permit,
      invocation.scope,
      invocation.text,
    );
    const recorded = await store.saveRevision({
      ...invocation.scope,
      permitJti: verified.permitJti,
      text: invocation.text,
    });
    return RecordReviewerDraftRevisionResultDtoSchema.parse({
      operation: invocation.operation,
      ...recorded,
    });
  };
}
