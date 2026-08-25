import type {
  ForgetReviewSessionInvocationDto,
  ForgetReviewSessionInvocationResultDto,
  PublicSurveyContextDto,
  SaveReviewSessionProgressInvocationDto,
  SaveReviewSessionProgressInvocationResultDto,
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
      readonly stage?:
        | "entry"
        | "verification-required"
        | "verification-unavailable"
        | undefined;
      readonly provisionalSelection?:
        | {
            readonly rating: 1 | 2 | 3 | 4 | 5;
            readonly action: "generate" | "paraphrase";
          }
        | null
        | undefined;
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
  | { readonly status: "verification-required" }
  | { readonly status: "unavailable" };

export interface VerifyEntryInput {
  readonly entryChallengeHandle: string;
  readonly browserCapability: string;
  readonly verificationEvidence: string;
}

export type VerifyEntryResult =
  | {
      readonly status: "admitted";
      readonly reviewSessionHandle: string;
    }
  | { readonly status: "verification-unavailable" }
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
  verifyEntry?(input: VerifyEntryInput): Promise<VerifyEntryResult>;
  readReviewSession(
    input: ReadReviewSessionInput,
  ): Promise<ReadReviewSessionResult>;
  saveReviewSessionProgress?(
    input: SaveReviewSessionProgressInvocationDto["input"],
  ): Promise<SaveReviewSessionProgressInvocationResultDto["result"]>;
  forgetReviewSession?(
    input: ForgetReviewSessionInvocationDto["input"],
  ): Promise<ForgetReviewSessionInvocationResultDto["result"]>;
}
