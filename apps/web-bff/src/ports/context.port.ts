import type {
  PublicSurveyContextDto,
  ReviewSessionProjectionDto,
} from "@review/contracts/context";

export interface PrepareEntryInput {
  readonly tenantSlug: string;
  readonly locationSlug: string;
  readonly invitationToken: string | undefined;
  readonly tableRef: string | undefined;
  readonly browserCapability: string;
}

export type PrepareEntryResult =
  | {
      readonly status: "prepared";
      readonly entryChallengeHandle: string;
    }
  | { readonly status: "unavailable" };

export interface ReadEntryChallengeInput {
  readonly entryChallengeHandle: string;
  readonly browserCapability: string;
}

export type ReadEntryChallengeResult =
  | {
      readonly status: "ready";
      readonly context: PublicSurveyContextDto;
    }
  | { readonly status: "unavailable" };

export interface AdvanceEntryInput {
  readonly entryChallengeHandle: string;
  readonly browserCapability: string;
  readonly rating: 1 | 2 | 3 | 4 | 5;
  readonly action: "generate" | "paraphrase";
}

export type AdvanceEntryResult =
  | {
      readonly status: "admitted";
      readonly reviewSessionHandle: string;
    }
  | { readonly status: "unavailable" };

export interface ReadReviewSessionInput {
  readonly reviewSessionHandle: string;
  readonly browserCapability: string;
}

export type ReadReviewSessionResult =
  | ReviewSessionProjectionDto
  | { readonly status: "unavailable" };

export interface ContextPort {
  prepareEntry(input: PrepareEntryInput): Promise<PrepareEntryResult>;
  readEntryChallenge(
    input: ReadEntryChallengeInput,
  ): Promise<ReadEntryChallengeResult>;
  advanceEntry(input: AdvanceEntryInput): Promise<AdvanceEntryResult>;
  readReviewSession(
    input: ReadReviewSessionInput,
  ): Promise<ReadReviewSessionResult>;
}
