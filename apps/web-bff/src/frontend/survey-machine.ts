import type { PublicSurveyContextDto } from "@review/contracts/context";

export interface ProvisionalSelection {
  readonly rating: 1 | 2 | 3 | 4 | 5;
  readonly action: "generate" | "paraphrase";
}

export type SurveyState =
  | {
      readonly value: "entry-loading";
      readonly entryChallengeHandle: string;
    }
  | {
      readonly value: "entry";
      readonly entryChallengeHandle: string;
      readonly context: PublicSurveyContextDto;
      readonly rating: 1 | 2 | 3 | 4 | 5 | null;
      readonly selectedAction: "generate" | "paraphrase" | null;
    }
  | {
      readonly value: "entry-submitting";
      readonly entryChallengeHandle: string;
      readonly context: PublicSurveyContextDto;
      readonly rating: 1 | 2 | 3 | 4 | 5;
      readonly selectedAction: "generate" | "paraphrase";
    }
  | {
      readonly value: "verification";
      readonly entryChallengeHandle: string;
      readonly context: PublicSurveyContextDto;
      readonly provisionalSelection: ProvisionalSelection | null;
      readonly verificationEvidence: string;
      readonly submissionFailed: boolean;
    }
  | {
      readonly value: "verification-unavailable";
      readonly entryChallengeHandle: string;
      readonly context: PublicSurveyContextDto;
      readonly provisionalSelection: ProvisionalSelection | null;
      readonly verificationEvidence: string;
    };

export type SurveyEvent =
  | {
      readonly type: "ENTRY_PREPARED";
      readonly context: PublicSurveyContextDto;
      readonly stage?:
        | "entry"
        | "verification-required"
        | "verification-unavailable"
        | undefined;
      readonly provisionalSelection?: ProvisionalSelection | null | undefined;
    }
  | {
      readonly type: "RATING_SELECTED";
      readonly rating: 1 | 2 | 3 | 4 | 5;
    }
  | {
      readonly type: "ACTION_SELECTED";
      readonly action: "generate" | "paraphrase";
    }
  | { readonly type: "START_REQUESTED" }
  | { readonly type: "START_FAILED" }
  | { readonly type: "VERIFICATION_REQUIRED" }
  | {
      readonly type: "VERIFICATION_EVIDENCE_CHANGED";
      readonly value: string;
    }
  | { readonly type: "VERIFICATION_FAILED" }
  | { readonly type: "VERIFICATION_UNAVAILABLE" }
  | { readonly type: "RETURN_TO_VERIFICATION" };

export function createSurveyState(entryChallengeHandle: string): SurveyState {
  return { value: "entry-loading", entryChallengeHandle };
}

export function transition(state: SurveyState, event: SurveyEvent): SurveyState {
  if (state.value === "entry-loading" && event.type === "ENTRY_PREPARED") {
    if (event.stage === "verification-required") {
      return {
        value: "verification",
        entryChallengeHandle: state.entryChallengeHandle,
        context: event.context,
        provisionalSelection: event.provisionalSelection ?? null,
        verificationEvidence: "",
        submissionFailed: false,
      };
    }
    if (event.stage === "verification-unavailable") {
      return {
        value: "verification-unavailable",
        entryChallengeHandle: state.entryChallengeHandle,
        context: event.context,
        provisionalSelection: event.provisionalSelection ?? null,
        verificationEvidence: "",
      };
    }
    return {
      value: "entry",
      entryChallengeHandle: state.entryChallengeHandle,
      context: event.context,
      rating: null,
      selectedAction: null,
    };
  }

  if (state.value === "entry" && event.type === "RATING_SELECTED") {
    return { ...state, rating: event.rating };
  }

  if (state.value === "entry" && event.type === "ACTION_SELECTED") {
    return { ...state, selectedAction: event.action };
  }

  if (
    state.value === "entry" &&
    event.type === "START_REQUESTED" &&
    state.rating !== null &&
    state.selectedAction !== null
  ) {
    return {
      value: "entry-submitting",
      entryChallengeHandle: state.entryChallengeHandle,
      context: state.context,
      rating: state.rating,
      selectedAction: state.selectedAction,
    };
  }

  if (state.value === "entry-submitting" && event.type === "START_FAILED") {
    return {
      value: "entry",
      entryChallengeHandle: state.entryChallengeHandle,
      context: state.context,
      rating: state.rating,
      selectedAction: state.selectedAction,
    };
  }

  if (
    state.value === "entry-submitting" &&
    event.type === "VERIFICATION_REQUIRED"
  ) {
    return {
      value: "verification",
      entryChallengeHandle: state.entryChallengeHandle,
      context: state.context,
      provisionalSelection: {
        rating: state.rating,
        action: state.selectedAction,
      },
      verificationEvidence: "",
      submissionFailed: false,
    };
  }

  if (
    state.value === "verification" &&
    event.type === "VERIFICATION_EVIDENCE_CHANGED"
  ) {
    return event.value.length <= 500
      ? {
          ...state,
          verificationEvidence: event.value,
          submissionFailed: false,
        }
      : state;
  }

  if (
    state.value === "verification" &&
    event.type === "VERIFICATION_UNAVAILABLE"
  ) {
    return {
      value: "verification-unavailable",
      entryChallengeHandle: state.entryChallengeHandle,
      context: state.context,
      provisionalSelection: state.provisionalSelection,
      verificationEvidence: state.verificationEvidence,
    };
  }

  if (
    state.value === "verification" &&
    event.type === "VERIFICATION_FAILED"
  ) {
    return { ...state, submissionFailed: true };
  }

  if (
    state.value === "verification-unavailable" &&
    event.type === "RETURN_TO_VERIFICATION"
  ) {
    return {
      value: "verification",
      entryChallengeHandle: state.entryChallengeHandle,
      context: state.context,
      provisionalSelection: state.provisionalSelection,
      verificationEvidence: state.verificationEvidence,
      submissionFailed: false,
    };
  }

  return state;
}
