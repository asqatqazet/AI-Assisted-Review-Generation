import type { PublicSurveyContextDto } from "@review/contracts/context";

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
    };

export type SurveyEvent =
  | {
      readonly type: "ENTRY_PREPARED";
      readonly context: PublicSurveyContextDto;
    }
  | {
      readonly type: "RATING_SELECTED";
      readonly rating: 1 | 2 | 3 | 4 | 5;
    }
  | {
      readonly type: "ACTION_SELECTED";
      readonly action: "generate" | "paraphrase";
    }
  | { readonly type: "START_REQUESTED" };

export function createSurveyState(entryChallengeHandle: string): SurveyState {
  return { value: "entry-loading", entryChallengeHandle };
}

export function transition(state: SurveyState, event: SurveyEvent): SurveyState {
  if (state.value === "entry-loading" && event.type === "ENTRY_PREPARED") {
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

  return state;
}
