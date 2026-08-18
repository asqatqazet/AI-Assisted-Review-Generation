import {
  RecordReviewerDispositionInvocationDtoSchema,
  RecordReviewerDispositionResultDtoSchema,
  type ReviewerDispositionScopeDto,
} from "@review/contracts/generation";
import { normalisedEditDistance } from "@review/domain/generation";

export interface ReviewerDispositionPermitVerifier {
  verifyDispositionPermit(
    permit: string,
    scope: ReviewerDispositionScopeDto,
    finalText: string,
  ): Promise<{ readonly permitJti: string }>;
}

export interface ReviewerDispositionStore {
  readOriginal(input: ReviewerDispositionScopeDto): Promise<{
    readonly text: string;
  }>;
  record(input: ReviewerDispositionScopeDto & {
    readonly permitJti: string;
    readonly finalText: string;
    readonly normalizedEditDistance: number;
  }): Promise<{
    readonly kind: "accepted" | "edited";
    readonly revision: number;
    readonly normalizedEditDistance: number;
  }>;
}

export function createReviewerDispositionHandler({
  verifier,
  store,
}: {
  readonly verifier: ReviewerDispositionPermitVerifier;
  readonly store: ReviewerDispositionStore;
}): (event: unknown) => Promise<unknown> {
  return async (event) => {
    const invocation = RecordReviewerDispositionInvocationDtoSchema.parse(event);
    const verified = await verifier.verifyDispositionPermit(
      invocation.permit,
      invocation.scope,
      invocation.finalText,
    );
    const original = await store.readOriginal(invocation.scope);
    const normalizedEditDistance = normalisedEditDistance(
      { body: original.text, systemAnnotations: [] },
      { body: invocation.finalText, systemAnnotations: [] },
    );
    const recorded = await store.record({
      ...invocation.scope,
      permitJti: verified.permitJti,
      finalText: invocation.finalText,
      normalizedEditDistance,
    });
    return RecordReviewerDispositionResultDtoSchema.parse({
      operation: invocation.operation,
      status: "recorded",
      ...recorded,
    });
  };
}
