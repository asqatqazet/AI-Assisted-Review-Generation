import { describe, expect, it } from "vitest";

import { ClaimDtoSchema, UnsupportedOutputDtoSchema } from "./candidate.js";

describe("candidate wire values", () => {
  it("accepts a Claim grounded to an Assertion in the same Review Session", () => {
    const claim = ClaimDtoSchema.parse({
      id: "claim-a",
      text: "The dentist explained the treatment before starting.",
      segmentIds: ["segment-a"],
      grounding: [{ kind: "assertion", assertionId: "assertion-a" }],
    });

    expect(claim.grounding).toEqual([
      { kind: "assertion", assertionId: "assertion-a" },
    ]);
  });

  it("rejects the prototype's null-provenance Claim shape", () => {
    const result = ClaimDtoSchema.safeParse({
      id: "claim-a",
      text: "They gave me a discount.",
      sourceKeywordId: null,
      sourceSpan: null,
    });

    expect(result.success).toBe(false);
  });

  it("represents rejected wording as Unsupported Output, not a Claim", () => {
    const value = {
      id: "unsupported-a",
      text: "They gave me a discount.",
      reason: "No discount was asserted.",
      category: "unsupported-proposition",
    };

    expect(UnsupportedOutputDtoSchema.parse(value)).toEqual(value);
    expect(ClaimDtoSchema.safeParse(value).success).toBe(false);
  });
});
