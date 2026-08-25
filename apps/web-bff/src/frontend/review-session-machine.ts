import type { ReviewSessionProjectionDto } from "@review/contracts/context";
import type {
  ReviewerDraftDto,
  ReviewerGenerationCommandDto,
  ReviewerGenerationRejectionCodeDto,
  ReviewerTransformationCommandDto,
} from "@review/contracts/generation";

export type ReviewerDraft = ReviewerDraftDto;

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
      readonly customerAssertion: string;
      readonly customerAssertionConfirmed: boolean;
    }
  | {
      readonly value: "paraphrase-input";
      readonly reviewSessionHandle: string;
      readonly projection: ReviewSessionProjectionDto;
      readonly sourceText: string;
    }
  | {
      readonly value: "format";
      readonly reviewSessionHandle: string;
      readonly projection: ReviewSessionProjectionDto;
      readonly selectedFactOptionIds: readonly string[];
      readonly customerAssertion: string;
      readonly sourceText: string;
      readonly selectedReviewFormatId: string | null;
      readonly sourceGenerationId?: string | undefined;
    }
  | {
      readonly value: "generating";
      readonly reviewSessionHandle: string;
      readonly projection: ReviewSessionProjectionDto;
      readonly selectedFactOptionIds: readonly string[];
      readonly customerAssertion: string;
      readonly sourceText: string;
      readonly selectedReviewFormatId: string;
      readonly idempotencyKey: string;
      readonly command?: ReviewerGenerationCommandDto | undefined;
    }
  | {
      readonly value: "results";
      readonly reviewSessionHandle: string;
      readonly projection: ReviewSessionProjectionDto;
      readonly selectedFactOptionIds: readonly string[];
      readonly customerAssertion: string;
      readonly sourceText: string;
      readonly selectedReviewFormatId: string;
      readonly draft: ReviewerDraft;
    }
  | {
      readonly value: "generation-failed";
      readonly reviewSessionHandle: string;
      readonly projection: ReviewSessionProjectionDto;
      readonly selectedFactOptionIds: readonly string[];
      readonly customerAssertion: string;
      readonly sourceText: string;
      readonly selectedReviewFormatId: string;
      readonly code: ReviewerGenerationRejectionCodeDto;
      readonly retryable: boolean;
      readonly retryAfterSeconds?: number | undefined;
      readonly command?: ReviewerGenerationCommandDto | undefined;
      readonly resumeIdempotencyKey?: string | undefined;
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
  | { readonly type: "CUSTOMER_ASSERTION_CHANGED"; readonly value: string }
  | { readonly type: "CUSTOMER_ASSERTION_CONFIRMED" }
  | { readonly type: "SOURCE_TEXT_CHANGED"; readonly value: string }
  | { readonly type: "CONTINUE_REQUESTED" }
  | {
      readonly type: "REVIEW_FORMAT_SELECTED";
      readonly reviewFormatId: string;
    }
  | {
      readonly type: "GENERATION_REQUESTED";
      readonly idempotencyKey: string;
    }
  | {
      readonly type: "GENERATION_SUCCEEDED";
      readonly draft: ReviewerDraft;
    }
  | {
      readonly type: "GENERATION_FAILED";
      readonly code: ReviewerGenerationRejectionCodeDto;
      readonly retryable: boolean;
      readonly retryAfterSeconds?: number | undefined;
      readonly resumeExisting?: boolean | undefined;
    }
  | {
      readonly type: "RETRY_REQUESTED";
      readonly idempotencyKey: string;
    }
  | {
      readonly type: "TRANSFORMATION_REQUESTED";
      readonly idempotencyKey: string;
      readonly command: ReviewerTransformationCommandDto;
    }
  | { readonly type: "RETURN_TO_FACTS" }
  | { readonly type: "RETURN_TO_FORMAT" };

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
    const progress = event.projection.progress;
    const newestDraft = event.projection.drafts?.at(-1);
    if (
      progress !== undefined &&
      ["results", "editing", "done"].includes(progress.phase) &&
      progress.selectedReviewFormatId !== null &&
      newestDraft !== undefined
    ) {
      return {
        value: "results",
        reviewSessionHandle: state.reviewSessionHandle,
        projection: event.projection,
        selectedFactOptionIds: progress.selectedFactOptionIds,
        customerAssertion: progress.customerAssertion,
        sourceText: progress.sourceText,
        selectedReviewFormatId: progress.selectedReviewFormatId,
        draft: newestDraft,
      };
    }
    if (progress?.phase === "format") {
      return {
        value: "format",
        reviewSessionHandle: state.reviewSessionHandle,
        projection: event.projection,
        selectedFactOptionIds: progress.selectedFactOptionIds,
        customerAssertion: progress.customerAssertion,
        sourceText: progress.sourceText,
        selectedReviewFormatId: progress.selectedReviewFormatId,
      };
    }
    if (event.projection.action === "paraphrase") {
      return {
        value: "paraphrase-input",
        reviewSessionHandle: state.reviewSessionHandle,
        projection: event.projection,
        sourceText: progress?.sourceText ?? "",
      };
    }
    return {
      value: "facts",
      reviewSessionHandle: state.reviewSessionHandle,
      projection: event.projection,
      selectedFactOptionIds: progress?.selectedFactOptionIds ?? [],
      customerAssertion: progress?.customerAssertion ?? "",
      customerAssertionConfirmed: false,
    };
  }

  if (
    state.value === "paraphrase-input" &&
    event.type === "SOURCE_TEXT_CHANGED"
  ) {
    return event.value.length <= 10_000
      ? { ...state, sourceText: event.value }
      : state;
  }

  if (
    state.value === "paraphrase-input" &&
    event.type === "CONTINUE_REQUESTED" &&
    state.sourceText.trim().length >= 20
  ) {
    return {
      value: "format",
      reviewSessionHandle: state.reviewSessionHandle,
      projection: state.projection,
      selectedFactOptionIds: [],
      customerAssertion: "",
      sourceText: state.sourceText,
      selectedReviewFormatId: null,
    };
  }

  if (state.value === "facts" && event.type === "CUSTOMER_ASSERTION_CHANGED") {
    return event.value.length <=
      state.projection.requirements.maximumCustomerAssertionChars
      ? {
          ...state,
          customerAssertion: event.value,
          customerAssertionConfirmed: false,
        }
      : state;
  }

  if (
    state.value === "facts" &&
    event.type === "CUSTOMER_ASSERTION_CONFIRMED" &&
    state.customerAssertion.trim().length > 0
  ) {
    return { ...state, customerAssertionConfirmed: true };
  }

  if (state.value === "facts" && event.type === "FACT_OPTION_TOGGLED") {
    if (
      !state.projection.factOptions.some(
        (factOption) => factOption.id === event.factOptionId,
      )
    ) {
      return state;
    }
    return {
      ...state,
      selectedFactOptionIds: state.selectedFactOptionIds.includes(
        event.factOptionId,
      )
        ? state.selectedFactOptionIds.filter(
            (factOptionId) => factOptionId !== event.factOptionId,
          )
        : [...state.selectedFactOptionIds, event.factOptionId],
    };
  }

  if (
    state.value === "facts" &&
    event.type === "CONTINUE_REQUESTED" &&
    ((state.customerAssertionConfirmed &&
      state.customerAssertion.trim().length > 0) ||
      state.selectedFactOptionIds.length >=
        state.projection.requirements.minimumFactSelections)
  ) {
    return {
      value: "format",
      reviewSessionHandle: state.reviewSessionHandle,
      projection: state.projection,
      selectedFactOptionIds: state.selectedFactOptionIds,
      customerAssertion: state.customerAssertionConfirmed
        ? state.customerAssertion
        : "",
      sourceText: "",
      selectedReviewFormatId: null,
    };
  }

  if (state.value === "format" && event.type === "RETURN_TO_FACTS") {
    if (state.projection.action === "paraphrase") {
      return {
        value: "paraphrase-input",
        reviewSessionHandle: state.reviewSessionHandle,
        projection: state.projection,
        sourceText: state.sourceText,
      };
    }
    return {
      value: "facts",
      reviewSessionHandle: state.reviewSessionHandle,
      projection: state.projection,
      selectedFactOptionIds: state.selectedFactOptionIds,
      customerAssertion: state.customerAssertion,
      customerAssertionConfirmed: state.customerAssertion.trim().length > 0,
    };
  }

  if (state.value === "format" && event.type === "REVIEW_FORMAT_SELECTED") {
    const requiredCommand =
      state.sourceGenerationId === undefined
        ? state.projection.action
        : "reformat";
    const available = state.projection.reviewFormats.some(
      (format) =>
        format.id === event.reviewFormatId &&
        format.availableCommands.includes(requiredCommand),
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
      customerAssertion: state.customerAssertion,
      sourceText: state.sourceText,
      selectedReviewFormatId: state.selectedReviewFormatId,
      idempotencyKey: event.idempotencyKey,
      ...(state.sourceGenerationId === undefined
        ? {}
        : {
            command: {
              action: "reformat" as const,
              sourceGenerationId: state.sourceGenerationId,
              reviewFormatId: state.selectedReviewFormatId,
            },
          }),
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
      customerAssertion: state.customerAssertion,
      sourceText: state.sourceText,
      selectedReviewFormatId: state.selectedReviewFormatId,
      draft: event.draft,
    };
  }

  if (state.value === "generating" && event.type === "GENERATION_FAILED") {
    return {
      value: "generation-failed",
      reviewSessionHandle: state.reviewSessionHandle,
      projection: state.projection,
      selectedFactOptionIds: state.selectedFactOptionIds,
      customerAssertion: state.customerAssertion,
      sourceText: state.sourceText,
      selectedReviewFormatId: state.selectedReviewFormatId,
      code: event.code,
      retryable: event.retryable,
      ...(event.retryAfterSeconds === undefined
        ? {}
        : { retryAfterSeconds: event.retryAfterSeconds }),
      ...(state.command === undefined ? {} : { command: state.command }),
      ...(event.resumeExisting === true
        ? { resumeIdempotencyKey: state.idempotencyKey }
        : {}),
    };
  }

  if (state.value === "generating" && event.type === "RETURN_TO_FACTS") {
    if (state.projection.action === "paraphrase") {
      return {
        value: "paraphrase-input",
        reviewSessionHandle: state.reviewSessionHandle,
        projection: state.projection,
        sourceText: state.sourceText,
      };
    }
    return {
      value: "facts",
      reviewSessionHandle: state.reviewSessionHandle,
      projection: state.projection,
      selectedFactOptionIds: state.selectedFactOptionIds,
      customerAssertion: state.customerAssertion,
      customerAssertionConfirmed: state.customerAssertion.trim().length > 0,
    };
  }

  /**
   * A reviewer who dislikes the Draft must be able to ask again. Resampling
   * reuses the Assertions and Review Format already confirmed, so it produces
   * another wording of the same facts rather than a different review.
   */
  if (state.value === "results" && event.type === "RETRY_REQUESTED") {
    return {
      value: "generating",
      reviewSessionHandle: state.reviewSessionHandle,
      projection: state.projection,
      selectedFactOptionIds: state.selectedFactOptionIds,
      customerAssertion: state.customerAssertion,
      sourceText: state.sourceText,
      selectedReviewFormatId: state.selectedReviewFormatId,
      idempotencyKey: event.idempotencyKey,
      command: {
        action: "resample",
        sourceGenerationId: state.draft.generationId,
      },
    };
  }

  if (
    state.value === "results" &&
    event.type === "TRANSFORMATION_REQUESTED" &&
    event.command.sourceGenerationId === state.draft.generationId
  ) {
    return {
      value: "generating",
      reviewSessionHandle: state.reviewSessionHandle,
      projection: state.projection,
      selectedFactOptionIds: state.selectedFactOptionIds,
      customerAssertion: state.customerAssertion,
      sourceText: state.sourceText,
      selectedReviewFormatId: state.selectedReviewFormatId,
      idempotencyKey: event.idempotencyKey,
      command: event.command,
    };
  }

  if (state.value === "results" && event.type === "RETURN_TO_FORMAT") {
    return {
      value: "format",
      reviewSessionHandle: state.reviewSessionHandle,
      projection: state.projection,
      selectedFactOptionIds: state.selectedFactOptionIds,
      customerAssertion: state.customerAssertion,
      sourceText: state.sourceText,
      // Reopened so another style can be picked, with the previous one shown
      // as the current choice.
      selectedReviewFormatId: state.selectedReviewFormatId,
      sourceGenerationId: state.draft.generationId,
    };
  }

  if (state.value === "results" && event.type === "RETURN_TO_FACTS") {
    if (state.projection.action === "paraphrase") {
      return {
        value: "paraphrase-input",
        reviewSessionHandle: state.reviewSessionHandle,
        projection: state.projection,
        sourceText: state.sourceText,
      };
    }
    return {
      value: "facts",
      reviewSessionHandle: state.reviewSessionHandle,
      projection: state.projection,
      selectedFactOptionIds: state.selectedFactOptionIds,
      customerAssertion: state.customerAssertion,
      customerAssertionConfirmed: state.customerAssertion.trim().length > 0,
    };
  }

  if (
    state.value === "generation-failed" &&
    state.retryable &&
    event.type === "RETRY_REQUESTED"
  ) {
    return {
      value: "generating",
      reviewSessionHandle: state.reviewSessionHandle,
      projection: state.projection,
      selectedFactOptionIds: state.selectedFactOptionIds,
      customerAssertion: state.customerAssertion,
      sourceText: state.sourceText,
      selectedReviewFormatId: state.selectedReviewFormatId,
      idempotencyKey: state.resumeIdempotencyKey ?? event.idempotencyKey,
      ...(state.command === undefined ? {} : { command: state.command }),
    };
  }

  if (
    state.value === "generation-failed" &&
    event.type === "RETURN_TO_FORMAT"
  ) {
    return {
      value: "format",
      reviewSessionHandle: state.reviewSessionHandle,
      projection: state.projection,
      selectedFactOptionIds: state.selectedFactOptionIds,
      customerAssertion: state.customerAssertion,
      sourceText: state.sourceText,
      selectedReviewFormatId: state.selectedReviewFormatId,
      ...(state.command !== undefined &&
      "sourceGenerationId" in state.command
        ? { sourceGenerationId: state.command.sourceGenerationId }
        : {}),
    };
  }

  if (
    state.value === "generation-failed" &&
    event.type === "RETURN_TO_FACTS"
  ) {
    if (state.projection.action === "paraphrase") {
      return {
        value: "paraphrase-input",
        reviewSessionHandle: state.reviewSessionHandle,
        projection: state.projection,
        sourceText: state.sourceText,
      };
    }
    return {
      value: "facts",
      reviewSessionHandle: state.reviewSessionHandle,
      projection: state.projection,
      selectedFactOptionIds: state.selectedFactOptionIds,
      customerAssertion: state.customerAssertion,
      customerAssertionConfirmed: state.customerAssertion.trim().length > 0,
    };
  }

  return state;
}
