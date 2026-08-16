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
});
