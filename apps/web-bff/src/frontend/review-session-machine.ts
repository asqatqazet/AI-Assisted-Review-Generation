import type { ReviewSessionProjectionDto } from "@review/contracts/context";

export type ReviewSessionState =
  | {
      readonly value: "review-session-loading";
      readonly reviewSessionHandle: string;
    }
  | {
      readonly value: "facts";
      readonly reviewSessionHandle: string;
      readonly projection: ReviewSessionProjectionDto;
      readonly selectedFactOptionIds: readonly string[];
    }
  | {
      readonly value: "format";
      readonly reviewSessionHandle: string;
      readonly projection: ReviewSessionProjectionDto;
      readonly selectedFactOptionIds: readonly string[];
      readonly selectedReviewFormatId: string | null;
    };

export type ReviewSessionEvent =
  | {
      readonly type: "REVIEW_SESSION_LOADED";
      readonly projection: ReviewSessionProjectionDto;
    }
  | {
      readonly type: "FACT_OPTION_TOGGLED";
      readonly factOptionId: string;
    }
  | { readonly type: "CONTINUE_REQUESTED" };

export function createReviewSessionState(
  reviewSessionHandle: string,
): ReviewSessionState {
  return { value: "review-session-loading", reviewSessionHandle };
}

export function transitionReviewSession(
  state: ReviewSessionState,
  event: ReviewSessionEvent,
): ReviewSessionState {
  if (
    state.value === "review-session-loading" &&
    event.type === "REVIEW_SESSION_LOADED"
  ) {
    return {
      value: "facts",
      reviewSessionHandle: state.reviewSessionHandle,
      projection: event.projection,
      selectedFactOptionIds: [],
    };
  }

  if (state.value === "facts" && event.type === "FACT_OPTION_TOGGLED") {
    if (
      !state.projection.factOptions.some(
        (factOption) => factOption.id === event.factOptionId,
      )
    ) {
      return state;
    }
    const selected = new Set(state.selectedFactOptionIds);
    if (selected.has(event.factOptionId)) {
      selected.delete(event.factOptionId);
    } else {
      selected.add(event.factOptionId);
    }
    return {
      ...state,
      selectedFactOptionIds: state.projection.factOptions
        .map((factOption) => factOption.id)
        .filter((factOptionId) => selected.has(factOptionId)),
    };
  }

  if (
    state.value === "facts" &&
    event.type === "CONTINUE_REQUESTED" &&
    state.selectedFactOptionIds.length > 0
  ) {
    return {
      value: "format",
      reviewSessionHandle: state.reviewSessionHandle,
      projection: state.projection,
      selectedFactOptionIds: state.selectedFactOptionIds,
      selectedReviewFormatId: null,
    };
  }

  return state;
}
