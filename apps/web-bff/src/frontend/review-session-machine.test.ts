import type { ReviewSessionProjectionDto } from "@review/contracts/context";
import { describe, expect, it } from "vitest";

import {
  createReviewSessionState,
  transitionReviewSession,
  type ReviewSessionState,
} from "./review-session-machine.js";

const projection: ReviewSessionProjectionDto = {
  status: "ready",
  reviewSessionHandle: "review-session-demo",
  tenantDisplayName: "Apex Dental",
  locationDisplayName: "Central Clinic",
  locale: "en-GB",
  requirements: {
    minimumFactSelections: 1,
    maximumReviewFormatsPerGeneration: 1,
    maximumCustomerAssertionChars: 500,
  },
  rating: 4,
  action: "generate",
  factOptions: [
    {
      id: "fact-attentive",
      label: "The team was attentive",
      categoryLabel: "Service",
      polarity: "positive",
    },
  ],
  reviewFormats: [
    {
      id: "format-concise-v1",
      displayName: "Concise blurb",
      description: "One concise paragraph.",
      sample: "The team was attentive.",
      targetPlatform: "google",
      constraints: { minChars: 20, maxChars: 420 },
      availableCommands: ["generate"],
    },
  ],
  destinations: [
    {
      targetPlatform: "google",
      displayName: "Google Maps",
      targetUrl: "https://example.test/review",
    },
  ],
};

describe("Review Session transition table", () => {
  it("does not advance until the backend-projected minimum Fact Option count is met", () => {
    const loaded = transitionReviewSession(
      createReviewSessionState("review-session-demo"),
      {
        type: "REVIEW_SESSION_LOADED",
        projection: {
          ...projection,
          requirements: {
            minimumFactSelections: 2,
            maximumReviewFormatsPerGeneration: 1,
            maximumCustomerAssertionChars: 500,
          },
          factOptions: [
            ...projection.factOptions,
            {
              id: "fact-friendly",
              label: "The team was friendly",
              categoryLabel: "Service",
              polarity: "positive",
            },
          ],
        },
      },
    );
    const selectedOne = transitionReviewSession(loaded, {
      type: "FACT_OPTION_TOGGLED",
      factOptionId: "fact-attentive",
    });

    expect(
      transitionReviewSession(selectedOne, { type: "CONTINUE_REQUESTED" }),
    ).toBe(selectedOne);
  });

  it("moves a confirmed Fact Option from facts into Format choice", () => {
    const loaded = transitionReviewSession(
      createReviewSessionState("review-session-demo"),
      { type: "REVIEW_SESSION_LOADED", projection },
    );
    const selected = transitionReviewSession(loaded, {
      type: "FACT_OPTION_TOGGLED",
      factOptionId: "fact-attentive",
    });

    expect(
      transitionReviewSession(selected, { type: "CONTINUE_REQUESTED" }),
    ).toMatchObject({
      value: "format",
      selectedFactOptionIds: ["fact-attentive"],
      selectedReviewFormatId: null,
    });
  });

  it("preserves the reviewer's Fact Option selection order", () => {
    const secondFact = {
      id: "fact-friendly",
      label: "The team was friendly",
      categoryLabel: "Service",
      polarity: "positive" as const,
    };
    const loaded = transitionReviewSession(
      createReviewSessionState("review-session-demo"),
      {
        type: "REVIEW_SESSION_LOADED",
        projection: {
          ...projection,
          factOptions: [...projection.factOptions, secondFact],
        },
      },
    );
    const selectedSecond = transitionReviewSession(loaded, {
      type: "FACT_OPTION_TOGGLED",
      factOptionId: secondFact.id,
    });
    const selectedFirst = transitionReviewSession(selectedSecond, {
      type: "FACT_OPTION_TOGGLED",
      factOptionId: "fact-attentive",
    });

    expect(selectedFirst).toMatchObject({
      selectedFactOptionIds: ["fact-friendly", "fact-attentive"],
    });
  });

  it("retains only a reviewer assertion within the backend-projected limit", () => {
    const loaded = transitionReviewSession(
      createReviewSessionState("review-session-demo"),
      {
        type: "REVIEW_SESSION_LOADED",
        projection: {
          ...projection,
          requirements: {
            ...projection.requirements,
            maximumCustomerAssertionChars: 24,
          },
        },
      },
    );
    const asserted = transitionReviewSession(loaded, {
      type: "CUSTOMER_ASSERTION_CHANGED",
      value: "The reception was calm.",
    });

    expect(asserted).toMatchObject({
      customerAssertion: "The reception was calm.",
    });
    expect(
      transitionReviewSession(asserted, {
        type: "CUSTOMER_ASSERTION_CHANGED",
        value: "The reception was calm and especially welcoming.",
      }),
    ).toBe(asserted);
  });

  it("freezes the selected facts and Review Format for Generation", () => {
    const loaded = transitionReviewSession(
      createReviewSessionState("review-session-demo"),
      { type: "REVIEW_SESSION_LOADED", projection },
    );
    const selectedFact = transitionReviewSession(loaded, {
      type: "FACT_OPTION_TOGGLED",
      factOptionId: "fact-attentive",
    });
    const format = transitionReviewSession(selectedFact, {
      type: "CONTINUE_REQUESTED",
    });
    const selectedFormat = transitionReviewSession(format, {
      type: "REVIEW_FORMAT_SELECTED",
      reviewFormatId: "format-concise-v1",
    });

    expect(
      transitionReviewSession(selectedFormat, {
        type: "GENERATION_REQUESTED",
        idempotencyKey: "generation-request-a",
      }),
    ).toMatchObject({
      value: "generating",
      reviewSessionHandle: "review-session-demo",
      selectedFactOptionIds: ["fact-attentive"],
      selectedReviewFormatId: "format-concise-v1",
    });
  });

  it("reveals a Draft only after terminal Generation success", () => {
    const loaded = transitionReviewSession(
      createReviewSessionState("review-session-demo"),
      { type: "REVIEW_SESSION_LOADED", projection },
    );
    const selectedFact = transitionReviewSession(loaded, {
      type: "FACT_OPTION_TOGGLED",
      factOptionId: "fact-attentive",
    });
    const format = transitionReviewSession(selectedFact, {
      type: "CONTINUE_REQUESTED",
    });
    const selectedFormat = transitionReviewSession(format, {
      type: "REVIEW_FORMAT_SELECTED",
      reviewFormatId: "format-concise-v1",
    });
    const generating = transitionReviewSession(selectedFormat, {
      type: "GENERATION_REQUESTED",
      idempotencyKey: "generation-request-a",
    });

    expect(
      transitionReviewSession(generating, {
        type: "GENERATION_SUCCEEDED",
        draft: {
          id: "draft-a",
          generationId: "generation-a",
          revision: 1,
          text: "The team was attentive.",
        },
      }),
    ).toMatchObject({
      value: "results",
      draft: {
        id: "draft-a",
        generationId: "generation-a",
        text: "The team was attentive.",
      },
    });
  });

  it("retains frozen choices on failure and retries with a fresh request", () => {
    const loaded = transitionReviewSession(
      createReviewSessionState("review-session-demo"),
      { type: "REVIEW_SESSION_LOADED", projection },
    );
    const selectedFact = transitionReviewSession(loaded, {
      type: "FACT_OPTION_TOGGLED",
      factOptionId: "fact-attentive",
    });
    const format = transitionReviewSession(selectedFact, {
      type: "CONTINUE_REQUESTED",
    });
    const selectedFormat = transitionReviewSession(format, {
      type: "REVIEW_FORMAT_SELECTED",
      reviewFormatId: "format-concise-v1",
    });
    const generating = transitionReviewSession(selectedFormat, {
      type: "GENERATION_REQUESTED",
      idempotencyKey: "generation-request-a",
    });
    const failed = transitionReviewSession(generating, {
      type: "GENERATION_FAILED",
      code: "PROVIDER_UNAVAILABLE",
      retryable: true,
    });

    expect(failed).toMatchObject({
      value: "generation-failed",
      selectedFactOptionIds: ["fact-attentive"],
      selectedReviewFormatId: "format-concise-v1",
      code: "PROVIDER_UNAVAILABLE",
      retryable: true,
    });
    expect(
      transitionReviewSession(failed, {
        type: "RETRY_REQUESTED",
        idempotencyKey: "generation-request-b",
      }),
    ).toMatchObject({
      value: "generating",
      idempotencyKey: "generation-request-b",
    });
  });

  it("returns a grounded rejection to the retained Fact choices", () => {
    const loaded = transitionReviewSession(
      createReviewSessionState("review-session-demo"),
      { type: "REVIEW_SESSION_LOADED", projection },
    );
    const selectedFact = transitionReviewSession(loaded, {
      type: "FACT_OPTION_TOGGLED",
      factOptionId: "fact-attentive",
    });
    const format = transitionReviewSession(selectedFact, {
      type: "CONTINUE_REQUESTED",
    });
    const selectedFormat = transitionReviewSession(format, {
      type: "REVIEW_FORMAT_SELECTED",
      reviewFormatId: "format-concise-v1",
    });
    const generating = transitionReviewSession(selectedFormat, {
      type: "GENERATION_REQUESTED",
      idempotencyKey: "generation-request-a",
    });
    const failed = transitionReviewSession(generating, {
      type: "GENERATION_FAILED",
      code: "GROUNDING_REJECTED",
      retryable: false,
    });

    expect(
      transitionReviewSession(failed, { type: "RETURN_TO_FACTS" }),
    ).toMatchObject({
      value: "facts",
      selectedFactOptionIds: ["fact-attentive"],
    });
  });
});

describe("US-03.5 reworking a draft the reviewer is not happy with", () => {
  function atResults(): ReviewSessionState {
    const loaded = transitionReviewSession(
      createReviewSessionState("review-session-demo"),
      { type: "REVIEW_SESSION_LOADED", projection },
    );
    const chosen = transitionReviewSession(loaded, {
      type: "FACT_OPTION_TOGGLED",
      factOptionId: "fact-attentive",
    });
    const continued = transitionReviewSession(chosen, {
      type: "CONTINUE_REQUESTED",
    });
    const formatted = transitionReviewSession(continued, {
      type: "REVIEW_FORMAT_SELECTED",
      reviewFormatId: "format-concise-v1",
    });
    const generating = transitionReviewSession(formatted, {
      type: "GENERATION_REQUESTED",
      idempotencyKey: "key-1",
    });
    return transitionReviewSession(generating, {
      type: "GENERATION_SUCCEEDED",
      draft: {
        id: "draft-a",
        generationId: "generation-a",
        revision: 1,
        text: "The team was attentive.",
      },
    });
  }

  it("resamples from the same confirmed Assertions and Review Format", () => {
    const results = atResults();

    const again = transitionReviewSession(results, {
      type: "RETRY_REQUESTED",
      idempotencyKey: "key-2",
    });

    // A resample reuses the inputs the reviewer already confirmed; it must not
    // silently widen or drop them.
    expect(again).toMatchObject({
      value: "generating",
      selectedFactOptionIds: ["fact-attentive"],
      selectedReviewFormatId: "format-concise-v1",
      idempotencyKey: "key-2",
    });
  });

  it("lets the reviewer choose a different Review Format", () => {
    const results = atResults();

    expect(
      transitionReviewSession(results, { type: "RETURN_TO_FORMAT" }),
    ).toMatchObject({
      value: "format",
      selectedFactOptionIds: ["fact-attentive"],
    });
  });

  it("lets the reviewer change what they said before drafting again", () => {
    const results = atResults();

    expect(
      transitionReviewSession(results, { type: "RETURN_TO_FACTS" }),
    ).toMatchObject({
      value: "facts",
      selectedFactOptionIds: ["fact-attentive"],
    });
  });
});
