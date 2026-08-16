import type { PublicSurveyContextDto } from "@review/contracts/context";
import { describe, expect, it } from "vitest";

import { createSurveyState, transition } from "./survey-machine.js";

const context: PublicSurveyContextDto = {
  tenantDisplayName: "Apex Dental",
  locationDisplayName: "Central Clinic",
  locale: "en-GB",
  entryMode: "invite",
  ratingRequired: true,
  factOptions: [],
  reviewFormats: [],
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
});
