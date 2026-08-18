import type { ReviewerDispositionScopeDto } from "@review/contracts/generation";

export interface ReviewerDispositionContextPort {
  authorize(input: {
    readonly reviewSessionHandle: string;
    readonly browserCapability: string;
    readonly idempotencyKey: string;
    readonly draftId: string;
    readonly generationId: string;
    readonly finalTextHash: string;
  }): Promise<
    | {
        readonly status: "authorized";
        readonly permit: string;
        readonly scope: ReviewerDispositionScopeDto;
      }
    | { readonly status: "rejected" }
  >;
}

export interface ReviewerDispositionExecutionPort {
  record(input: {
    readonly permit: string;
    readonly scope: ReviewerDispositionScopeDto;
    readonly finalText: string;
  }): Promise<{
    readonly status: "recorded";
    readonly kind: "accepted" | "edited";
    readonly revision: number;
    readonly normalizedEditDistance: number;
  }>;
}
