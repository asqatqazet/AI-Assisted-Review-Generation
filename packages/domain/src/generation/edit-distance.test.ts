import { describe, expect, it } from "vitest";

import {
  MAX_EDIT_DISTANCE_CHARACTERS,
  normalisedEditDistance,
  type ComparableDraftRevision,
} from "./edit-distance.js";

const revision = (
  body: string,
  disclosure = "This review was drafted with AI assistance.",
): ComparableDraftRevision => ({
  body,
  systemAnnotations: [
    {
      kind: "assisted-review-disclosure",
      text: disclosure,
      policyVersionId: "tenant-policy-r1",
    },
  ],
});

describe("normalisedEditDistance", () => {
  it("returns zero for identical bodies", () => {
    expect(
      normalisedEditDistance(
        revision("The service was attentive."),
        revision("The service was attentive."),
      ),
    ).toBe(0);
  });

  it("normalises Unicode and collapses whitespace", () => {
    expect(
      normalisedEditDistance(
        revision("Cafe\u0301   was\nexcellent."),
        revision("Caf\u00e9 was excellent."),
      ),
    ).toBe(0);
  });

  it("ignores typed disclosure annotations", () => {
    expect(
      normalisedEditDistance(
        revision("The service was attentive.", "Old disclosure"),
        revision("The service was attentive.", "New disclosure"),
      ),
    ).toBe(0);
  });

  it("returns one for a complete same-length rewrite", () => {
    expect(
      normalisedEditDistance(revision("aaaa"), revision("bbbb")),
    ).toBe(1);
  });

  it("returns the Levenshtein distance divided by the longer body", () => {
    expect(normalisedEditDistance(revision("kitten"), revision("sitting"))).toBe(
      3 / 7,
    );
  });

  it.each([
    { original: "", submitted: "", expected: 0 },
    { original: "", submitted: "new text", expected: 1 },
    { original: "old text", submitted: "", expected: 1 },
  ])(
    "handles empty bodies: '$original' to '$submitted'",
    ({ original, submitted, expected }) => {
      expect(
        normalisedEditDistance(revision(original), revision(submitted)),
      ).toBe(expected);
    },
  );

  it("caps both normalised bodies before quadratic comparison", () => {
    const sharedPrefix = "a".repeat(MAX_EDIT_DISTANCE_CHARACTERS);

    expect(
      normalisedEditDistance(
        revision(`${sharedPrefix}original tail`),
        revision(`${sharedPrefix}submitted tail`),
      ),
    ).toBe(0);
  });

  it("does not mutate either Draft Revision", () => {
    const original = revision("Original text");
    const submitted = revision("Submitted text");
    const originalBefore = structuredClone(original);
    const submittedBefore = structuredClone(submitted);

    normalisedEditDistance(original, submitted);

    expect(original).toEqual(originalBefore);
    expect(submitted).toEqual(submittedBefore);
  });
});
