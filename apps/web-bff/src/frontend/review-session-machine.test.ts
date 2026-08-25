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
  it("loads Paraphrase into its own source-text step and preserves it into Format", () => {
    const loaded = transitionReviewSession(
      createReviewSessionState("review-session-demo"),
      {
        type: "REVIEW_SESSION_LOADED",
        projection: {
          ...projection,
          action: "paraphrase",
          reviewFormats: [
            {
              ...projection.reviewFormats[0]!,
              availableCommands: ["paraphrase"],
            },
          ],
          progress: {
            epoch: 2,
            phase: "paraphrase-input",
            selectedFactOptionIds: [],
            customerAssertion: "",
            sourceText: "The team was kind and the waiting area was quiet.",
            selectedReviewFormatId: null,
          },
        },
      },
    );

    expect(loaded).toMatchObject({
      value: "paraphrase-input",
      sourceText: "The team was kind and the waiting area was quiet.",
    });
    expect(
      transitionReviewSession(loaded, { type: "CONTINUE_REQUESTED" }),
    ).toMatchObject({
      value: "format",
      sourceText: "The team was kind and the waiting area was quiet.",
    });
  });

  it("hydrates confirmed input and Format choice from server progress after refresh", () => {
    const loaded = transitionReviewSession(
      createReviewSessionState("review-session-demo"),
      {
        type: "REVIEW_SESSION_LOADED",
        projection: {
          ...projection,
          progress: {
            epoch: 4,
            phase: "format",
            selectedFactOptionIds: ["fact-attentive"],
            customerAssertion: "The reception was calm.",
            sourceText: "",
            selectedReviewFormatId: "format-concise-v1",
          },
          drafts: [],
        },
      },
    );

    expect(loaded).toMatchObject({
      value: "format",
      selectedFactOptionIds: ["fact-attentive"],
      customerAssertion: "The reception was calm.",
      selectedReviewFormatId: "format-concise-v1",
    });
  });

  it("restores the newest persisted Draft instead of discarding it on refresh", () => {
    const loaded = transitionReviewSession(
      createReviewSessionState("review-session-demo"),
      {
        type: "REVIEW_SESSION_LOADED",
        projection: {
          ...projection,
          progress: {
            epoch: 6,
            phase: "results",
            selectedFactOptionIds: ["fact-attentive"],
            customerAssertion: "",
            sourceText: "",
            selectedReviewFormatId: "format-concise-v1",
          },
          drafts: [
            {
              id: "draft-a",
              generationId: "generation-a",
              revision: 1,
              text: "The team was attentive.",
              systemAnnotations: [],
            },
            {
              id: "draft-b",
              generationId: "generation-b",
              revision: 1,
              text: "Attentive service throughout.",
              systemAnnotations: [],
            },
          ],
        },
      },
    );

    expect(loaded).toMatchObject({
      value: "results",
      draft: { id: "draft-b", generationId: "generation-b" },
      selectedFactOptionIds: ["fact-attentive"],
    });
  });

  it("requires explicit confirmation before reviewer text becomes an Assertion", () => {
    const loaded = transitionReviewSession(
      createReviewSessionState("review-session-demo"),
      {
        type: "REVIEW_SESSION_LOADED",
        projection: {
          ...projection,
          requirements: {
            ...projection.requirements,
            minimumFactSelections: 2,
          },
        },
      },
    );
    const asserted = transitionReviewSession(loaded, {
      type: "CUSTOMER_ASSERTION_CHANGED",
      value: "The reception was calm.",
    });

    expect(asserted).toMatchObject({
      value: "facts",
      customerAssertion: "The reception was calm.",
      customerAssertionConfirmed: false,
    });
    expect(
      transitionReviewSession(asserted, { type: "CONTINUE_REQUESTED" }),
    ).toBe(asserted);

    const confirmed = transitionReviewSession(asserted, {
      type: "CUSTOMER_ASSERTION_CONFIRMED",
    });
    expect(
      transitionReviewSession(confirmed, { type: "CONTINUE_REQUESTED" }),
    ).toMatchObject({
      value: "format",
      selectedFactOptionIds: [],
      customerAssertion: "The reception was calm.",
    });

    const edited = transitionReviewSession(confirmed, {
      type: "CUSTOMER_ASSERTION_CHANGED",
      value: "The reception was calm and quiet.",
    });
    expect(edited).toMatchObject({ customerAssertionConfirmed: false });
    expect(
      transitionReviewSession(edited, { type: "CONTINUE_REQUESTED" }),
    ).toBe(edited);
  });

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

  it("returns from Format choice with all reviewer input intact", () => {
    const loaded = transitionReviewSession(
      createReviewSessionState("review-session-demo"),
      { type: "REVIEW_SESSION_LOADED", projection },
    );
    const asserted = transitionReviewSession(loaded, {
      type: "CUSTOMER_ASSERTION_CHANGED",
      value: "The reception was calm.",
    });
    const confirmed = transitionReviewSession(asserted, {
      type: "CUSTOMER_ASSERTION_CONFIRMED",
    });
    const confirmedAndSelected = transitionReviewSession(confirmed, {
      type: "FACT_OPTION_TOGGLED",
      factOptionId: "fact-attentive",
    });
    const format = transitionReviewSession(confirmedAndSelected, {
      type: "CONTINUE_REQUESTED",
    });

    expect(
      transitionReviewSession(format, { type: "RETURN_TO_FACTS" }),
    ).toMatchObject({
      value: "facts",
      selectedFactOptionIds: ["fact-attentive"],
      customerAssertion: "The reception was calm.",
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
          systemAnnotations: [],
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

  it("reuses the original idempotency key when retry means reconnecting", () => {
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
    const disconnected = transitionReviewSession(generating, {
      type: "GENERATION_FAILED",
      code: "GENERATION_FAILED",
      retryable: true,
      resumeExisting: true,
    });

    expect(
      transitionReviewSession(disconnected, {
        type: "RETRY_REQUESTED",
        idempotencyKey: "must-not-start-another-batch",
      }),
    ).toMatchObject({
      value: "generating",
      idempotencyKey: "generation-request-a",
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

  it("returns a Format rejection to the retained Format choice", () => {
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
      code: "FORMAT_REJECTED",
      retryable: false,
    });

    expect(
      transitionReviewSession(failed, { type: "RETURN_TO_FORMAT" }),
    ).toMatchObject({
      value: "format",
      selectedFactOptionIds: ["fact-attentive"],
      selectedReviewFormatId: "format-concise-v1",
    });
  });
});

describe("US-03.5 reworking a draft the reviewer is not happy with", () => {
  function atResults(): Extract<ReviewSessionState, { value: "results" }> {
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
    const results = transitionReviewSession(generating, {
      type: "GENERATION_SUCCEEDED",
      draft: {
        id: "draft-a",
        generationId: "generation-a",
        revision: 1,
        text: "The team was attentive.",
        systemAnnotations: [],
      },
    });
    if (results.value !== "results") {
      throw new Error("Expected a results state");
    }
    return results;
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
      command: {
        action: "resample",
        sourceGenerationId: "generation-a",
      },
    });
  });

  it("lets the reviewer choose a different Review Format", () => {
    const results = atResults();

    const choosing = transitionReviewSession(results, {
      type: "RETURN_TO_FORMAT",
    });
    expect(choosing).toMatchObject({
      value: "format",
      selectedFactOptionIds: ["fact-attentive"],
      sourceGenerationId: "generation-a",
    });
    const selected = transitionReviewSession(choosing, {
      type: "REVIEW_FORMAT_SELECTED",
      reviewFormatId: "format-concise-v1",
    });
    expect(
      transitionReviewSession(selected, {
        type: "GENERATION_REQUESTED",
        idempotencyKey: "key-reformat",
      }),
    ).toMatchObject({
      value: "generating",
      command: {
        action: "reformat",
        sourceGenerationId: "generation-a",
        reviewFormatId: "format-concise-v1",
      },
    });
  });

  it("selects a different Review Format through the Reformat capability", () => {
    const results = atResults();
    const targetFormat = {
      ...projection.reviewFormats[0]!,
      id: "format-detailed-v1",
      displayName: "Detailed review",
      availableCommands: ["reformat" as const],
    };
    const choosing = transitionReviewSession(
      {
        ...results,
        projection: {
          ...results.projection,
          reviewFormats: [...results.projection.reviewFormats, targetFormat],
        },
      },
      { type: "RETURN_TO_FORMAT" },
    );

    const selected = transitionReviewSession(choosing, {
      type: "REVIEW_FORMAT_SELECTED",
      reviewFormatId: targetFormat.id,
    });

    expect(selected).toMatchObject({
      value: "format",
      selectedReviewFormatId: targetFormat.id,
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

  it("binds a presentation transformation to the immutable source Generation", () => {
    const results = atResults();

    expect(
      transitionReviewSession(results, {
        type: "TRANSFORMATION_REQUESTED",
        idempotencyKey: "key-condense",
        command: {
          action: "condense",
          sourceGenerationId: "generation-a",
          targetMaxChars: 120,
        },
      }),
    ).toMatchObject({
      value: "generating",
      command: {
        action: "condense",
        sourceGenerationId: "generation-a",
        targetMaxChars: 120,
      },
    });

    expect(
      transitionReviewSession(results, {
        type: "TRANSFORMATION_REQUESTED",
        idempotencyKey: "key-forged",
        command: {
          action: "condense",
          sourceGenerationId: "another-generation",
          targetMaxChars: 120,
        },
      }),
    ).toBe(results);
  });

  it("returns a Paraphrase journey to its source text after a grounding rejection", () => {
    const paraphraseProjection: ReviewSessionProjectionDto = {
      ...projection,
      action: "paraphrase",
      reviewFormats: [
        {
          ...projection.reviewFormats[0]!,
          availableCommands: ["paraphrase"],
        },
      ],
    };
    const source = "The team was attentive and the waiting area was calm.";
    const loaded = transitionReviewSession(
      createReviewSessionState("review-session-demo"),
      { type: "REVIEW_SESSION_LOADED", projection: paraphraseProjection },
    );
    const typed = transitionReviewSession(loaded, {
      type: "SOURCE_TEXT_CHANGED",
      value: source,
    });
    const choosing = transitionReviewSession(typed, {
      type: "CONTINUE_REQUESTED",
    });
    const selected = transitionReviewSession(choosing, {
      type: "REVIEW_FORMAT_SELECTED",
      reviewFormatId: "format-concise-v1",
    });
    const generating = transitionReviewSession(selected, {
      type: "GENERATION_REQUESTED",
      idempotencyKey: "key-paraphrase",
    });
    const failed = transitionReviewSession(generating, {
      type: "GENERATION_FAILED",
      code: "GROUNDING_REJECTED",
      retryable: false,
    });

    expect(
      transitionReviewSession(failed, { type: "RETURN_TO_FACTS" }),
    ).toMatchObject({ value: "paraphrase-input", sourceText: source });
  });
});
