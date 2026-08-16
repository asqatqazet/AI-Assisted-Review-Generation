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

export type SurveyEvent = {
  readonly type: "ENTRY_PREPARED";
  readonly context: PublicSurveyContextDto;
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

  return state;
}
