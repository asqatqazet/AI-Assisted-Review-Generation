import type { PublicSurveyContextDto } from "@review/contracts/context";
import { describe, expect, it } from "vitest";

import { createSurveyState, transition } from "./survey-machine.js";

const context: PublicSurveyContextDto = {
  tenantDisplayName: "Apex Dental",
  locationDisplayName: "Central Clinic",
  locale: "en-GB",
  entryMode: "invite",
  ratingRequired: true,
  requirements: {
    minimumFactSelections: 1,
      maximumReviewFormatsPerGeneration: 1,
      maximumCustomerAssertionChars: 500,
  },
  factOptions: [],
  reviewFormats: [],
  destinations: [],
};

describe("Survey transition table", () => {
  it("moves a prepared Entry Challenge into the entry state", () => {
    const initial = createSurveyState("challenge-demo");

    expect(transition(initial, { type: "ENTRY_PREPARED", context })).toEqual({
      value: "entry",
      entryChallengeHandle: "challenge-demo",
      context,
      rating: null,
      selectedAction: null,
    });
  });

  it("restores a pending verification stage and its provisional choice", () => {
    const initial = createSurveyState("challenge-demo");

    expect(
      transition(initial, {
        type: "ENTRY_PREPARED",
        context,
        stage: "verification-required",
        provisionalSelection: { rating: 4, action: "paraphrase" },
      }),
    ).toEqual({
      value: "verification",
      entryChallengeHandle: "challenge-demo",
      context,
      provisionalSelection: { rating: 4, action: "paraphrase" },
      verificationEvidence: "",
      submissionFailed: false,
    });
  });

  it("keeps the reviewer-selected rating in the entry state", () => {
    const prepared = transition(createSurveyState("challenge-demo"), {
      type: "ENTRY_PREPARED",
      context,
    });

    expect(transition(prepared, { type: "RATING_SELECTED", rating: 4 })).toMatchObject({
      value: "entry",
      rating: 4,
      selectedAction: null,
    });
  });

  it("keeps the selected drafting path without losing the rating", () => {
    const prepared = transition(createSurveyState("challenge-demo"), {
      type: "ENTRY_PREPARED",
      context,
    });
    const rated = transition(prepared, { type: "RATING_SELECTED", rating: 5 });

    expect(transition(rated, { type: "ACTION_SELECTED", action: "paraphrase" })).toMatchObject({
      value: "entry",
      rating: 5,
      selectedAction: "paraphrase",
    });
  });

  it("submits a complete entry choice without discarding confirmed input", () => {
    const prepared = transition(createSurveyState("challenge-demo"), {
      type: "ENTRY_PREPARED",
      context,
    });
    const rated = transition(prepared, { type: "RATING_SELECTED", rating: 5 });
    const selected = transition(rated, { type: "ACTION_SELECTED", action: "generate" });

    expect(transition(selected, { type: "START_REQUESTED" })).toMatchObject({
      value: "entry-submitting",
      entryChallengeHandle: "challenge-demo",
      rating: 5,
      selectedAction: "generate",
    });
  });

  it("restores the confirmed choice when starting the Review Session fails", () => {
    const prepared = transition(createSurveyState("challenge-demo"), {
      type: "ENTRY_PREPARED",
      context,
    });
    const rated = transition(prepared, { type: "RATING_SELECTED", rating: 5 });
    const selected = transition(rated, {
      type: "ACTION_SELECTED",
      action: "generate",
    });
    const submitting = transition(selected, { type: "START_REQUESTED" });

    expect(transition(submitting, { type: "START_FAILED" })).toMatchObject({
      value: "entry",
      rating: 5,
      selectedAction: "generate",
    });
  });

  it("moves a submitted choice to verification without losing it", () => {
    const prepared = transition(createSurveyState("challenge-demo"), {
      type: "ENTRY_PREPARED",
      context,
    });
    const rated = transition(prepared, { type: "RATING_SELECTED", rating: 4 });
    const selected = transition(rated, {
      type: "ACTION_SELECTED",
      action: "generate",
    });
    const submitting = transition(selected, { type: "START_REQUESTED" });

    expect(
      transition(submitting, { type: "VERIFICATION_REQUIRED" }),
    ).toMatchObject({
      value: "verification",
      provisionalSelection: { rating: 4, action: "generate" },
      verificationEvidence: "",
      submissionFailed: false,
    });
  });

  it("keeps verification evidence recoverable when verification is unavailable", () => {
    const pending = transition(createSurveyState("challenge-demo"), {
      type: "ENTRY_PREPARED",
      context,
      stage: "verification-required",
      provisionalSelection: { rating: 4, action: "generate" },
    });
    const entered = transition(pending, {
      type: "VERIFICATION_EVIDENCE_CHANGED",
      value: "BS-4471-K",
    });
    const unavailable = transition(entered, {
      type: "VERIFICATION_UNAVAILABLE",
    });

    expect({
      entered,
      unavailable,
      restored: transition(unavailable, { type: "RETURN_TO_VERIFICATION" }),
    }).toMatchObject({
      entered: {
        value: "verification",
        verificationEvidence: "BS-4471-K",
        submissionFailed: false,
      },
      unavailable: {
        value: "verification-unavailable",
        verificationEvidence: "BS-4471-K",
        provisionalSelection: { rating: 4, action: "generate" },
      },
      restored: {
        value: "verification",
        verificationEvidence: "BS-4471-K",
        submissionFailed: false,
      },
    });
  });
});
