import type { ReviewSessionProjectionDto } from "@review/contracts/context";
import { describe, expect, it } from "vitest";

import {
  createReviewSessionState,
  transitionReviewSession,
} from "./review-session-machine.js";

const projection: ReviewSessionProjectionDto = {
  status: "ready",
  reviewSessionHandle: "review-session-demo",
  tenantDisplayName: "Apex Dental",
  locationDisplayName: "Central Clinic",
  locale: "en-GB",
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
      availableCommands: ["generate"],
    },
  ],
};

describe("Review Session transition table", () => {
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
      }),
    ).toMatchObject({
      value: "generating",
      reviewSessionHandle: "review-session-demo",
      selectedFactOptionIds: ["fact-attentive"],
      selectedReviewFormatId: "format-concise-v1",
    });
  });
});
