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
      readonly rating: number | null;
      readonly selectedAction: "generate" | "paraphrase" | null;
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
    };

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

  return state;
}
