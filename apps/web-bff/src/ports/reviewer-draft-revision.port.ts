import type { ReviewerDraftRevisionScopeDto } from "@review/contracts/generation";

export interface ReviewerDraftRevisionContextPort {
  authorize(input: {
    readonly reviewSessionHandle: string;
    readonly browserCapability: string;
    readonly idempotencyKey: string;
    readonly draftId: string;
    readonly generationId: string;
    readonly expectedRevision: number;
    readonly textHash: string;
  }): Promise<
    | {
        readonly status: "authorized";
        readonly permit: string;
        readonly scope: ReviewerDraftRevisionScopeDto;
      }
    | { readonly status: "rejected" }
  >;
}

export interface ReviewerDraftRevisionExecutionPort {
  record(input: {
    readonly permit: string;
    readonly scope: ReviewerDraftRevisionScopeDto;
    readonly text: string;
  }): Promise<{
    readonly status: "recorded" | "conflict";
    readonly revision: number;
  }>;
}
