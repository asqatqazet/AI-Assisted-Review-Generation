import type { ReviewSessionProjectionDto } from "@review/contracts/context";

export interface ReviewerDraft {
  readonly id: string;
  readonly generationId: string;
  readonly revision: number;
  readonly text: string;
}

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
    }
  | {
      readonly value: "generating";
      readonly reviewSessionHandle: string;
      readonly projection: ReviewSessionProjectionDto;
      readonly selectedFactOptionIds: readonly string[];
      readonly selectedReviewFormatId: string;
    }
  | {
      readonly value: "results";
      readonly reviewSessionHandle: string;
      readonly projection: ReviewSessionProjectionDto;
      readonly selectedFactOptionIds: readonly string[];
      readonly selectedReviewFormatId: string;
      readonly draft: ReviewerDraft;
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
  | { readonly type: "CONTINUE_REQUESTED" }
  | {
      readonly type: "REVIEW_FORMAT_SELECTED";
      readonly reviewFormatId: string;
    }
  | { readonly type: "GENERATION_REQUESTED" }
  | {
      readonly type: "GENERATION_SUCCEEDED";
      readonly draft: ReviewerDraft;
    };

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

  if (state.value === "format" && event.type === "REVIEW_FORMAT_SELECTED") {
    const available = state.projection.reviewFormats.some(
      (format) =>
        format.id === event.reviewFormatId &&
        format.availableCommands.includes(state.projection.action),
    );
    return available
      ? { ...state, selectedReviewFormatId: event.reviewFormatId }
      : state;
  }

  if (
    state.value === "format" &&
    event.type === "GENERATION_REQUESTED" &&
    state.selectedReviewFormatId !== null
  ) {
    return {
      value: "generating",
      reviewSessionHandle: state.reviewSessionHandle,
      projection: state.projection,
      selectedFactOptionIds: state.selectedFactOptionIds,
      selectedReviewFormatId: state.selectedReviewFormatId,
    };
  }

  if (
    state.value === "generating" &&
    event.type === "GENERATION_SUCCEEDED"
  ) {
    return {
      value: "results",
      reviewSessionHandle: state.reviewSessionHandle,
      projection: state.projection,
      selectedFactOptionIds: state.selectedFactOptionIds,
      selectedReviewFormatId: state.selectedReviewFormatId,
      draft: event.draft,
    };
  }

  return state;
}
