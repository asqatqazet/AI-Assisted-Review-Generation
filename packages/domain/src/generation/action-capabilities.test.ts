import { describe, expect, it } from "vitest";

import {
  isExecutableGenerationAction,
  resolveExecutableGenerationActions,
} from "./action-capabilities.js";

describe("production generation Action capabilities", () => {
  it("exposes only Actions whose production grounding predicate can validate the promised transformation", () => {
    expect(
      [
        "generate",
        "paraphrase",
        "resample",
        "reformat",
        "condense",
        "expand",
        "revise-wording",
      ].filter(isExecutableGenerationAction),
    ).toEqual(["generate"]);
  });

  it("resolves the executable post-locale Action x Prompt x Format intersection", () => {
    expect(
      resolveExecutableGenerationActions({
        enabledActions: ["generate", "paraphrase", "expand"],
        promptActions: ["generate", "paraphrase", "expand"],
        reviewFormats: [
          { supportedActions: ["generate", "expand"] },
          { supportedActions: ["paraphrase"] },
        ],
      }),
    ).toEqual(["generate"]);
  });

  it("requires exactly one Prompt and at least one compatible Format", () => {
    expect(
      resolveExecutableGenerationActions({
        enabledActions: ["generate", "paraphrase"],
        promptActions: ["generate", "generate", "paraphrase"],
        reviewFormats: [{ supportedActions: ["generate"] }],
      }),
    ).toEqual([]);
  });
});
