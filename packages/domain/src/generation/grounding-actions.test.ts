import { describe, expect, it } from "vitest";

import {
  evaluateGrounding,
  type Candidate,
  type ClaimGroundingReference,
  type GenerationAssertion,
  type GroundedSourceClaim,
  type GroundingEvaluationInput,
} from "./grounding-guard.js";

const serviceGrounding: readonly ClaimGroundingReference[] = [
  {
    kind: "assertion",
    assertionId: "assertion-service",
    assertionVersion: "assertion-service-v1",
  },
];

const serviceAssertion: GenerationAssertion = {
  id: "assertion-service",
  version: "assertion-service-v1",
  reviewSessionId: "review-session-a",
  semanticId: "service-attentive",
  semanticKind: "experience-fact",
  polarity: "positive",
  source: {
    kind: "reviewer-text",
    sourceRevisionId: "source-text-v1",
    start: 0,
    end: 22,
    quotedText: "The service was good.",
  },
};

const parkingAssertion: GenerationAssertion = {
  id: "assertion-parking",
  version: "assertion-parking-v1",
  reviewSessionId: "review-session-a",
  semanticId: "parking-easy",
  semanticKind: "experience-fact",
  polarity: "positive",
  source: {
    kind: "confirmed-fact",
    sourceRevisionId: "confirmed-fact-v1",
  },
};

const sourceClaims: readonly GroundedSourceClaim[] = [
  { semanticId: "service-attentive", grounding: serviceGrounding },
];

const serviceCandidate = (text = "The service was attentive."): Candidate => ({
  claims: [
    {
      id: "claim-service",
      semanticId: "service-attentive",
      semanticKind: "experience-fact",
      polarity: "positive",
      text,
      grounding: serviceGrounding,
    },
  ],
  segments: [{ kind: "claim", claimId: "claim-service" }],
});

const parkingClaim = {
  id: "claim-parking",
  semanticId: "parking-easy",
  semanticKind: "experience-fact" as const,
  polarity: "positive" as const,
  text: "Parking was easy.",
  grounding: [
    {
      kind: "assertion" as const,
      assertionId: "assertion-parking",
      assertionVersion: "assertion-parking-v1",
    },
  ],
};

const twoClaimCandidate = (): Candidate => ({
  claims: [...serviceCandidate().claims, parkingClaim],
  segments: [
    { kind: "claim", claimId: "claim-service" },
    { kind: "connector", text: " " },
    { kind: "claim", claimId: "claim-parking" },
  ],
});

const actionInput = (
  postcondition: GroundingEvaluationInput["postcondition"],
  overrides: Partial<GroundingEvaluationInput> = {},
): GroundingEvaluationInput => ({
  reviewSessionId: "review-session-a",
  candidate: serviceCandidate(),
  assertions: [serviceAssertion, parkingAssertion],
  permittedContextFacts: [],
  postcondition,
  ...overrides,
});

const expectRejectedFor = (
  result: ReturnType<typeof evaluateGrounding>,
  code: string,
): void => {
  expect(result).toMatchObject({
    verdict: "rejected",
    candidate: null,
    draftBody: null,
    reasons: expect.arrayContaining([
      expect.objectContaining({ code }),
    ]),
  });
};

describe("evaluateGrounding Action postconditions", () => {
  it("allows Reformat to preserve the complete source Claim set", () => {
    const result = evaluateGrounding(
      actionInput({ kind: "reformat", sourceClaims }),
    );

    expect(result.verdict).toBe("pass");
  });

  it("rejects a Reformat that adds a Claim", () => {
    const result = evaluateGrounding(
      actionInput(
        { kind: "reformat", sourceClaims },
        { candidate: twoClaimCandidate() },
      ),
    );

    expectRejectedFor(result, "claim-added-by-transformation");
  });

  it("allows Condense to drop a whole Claim while becoming shorter", () => {
    const result = evaluateGrounding(
      actionInput({
        kind: "condense",
        sourceClaims: [
          ...sourceClaims,
          {
            semanticId: "parking-easy",
            grounding: parkingClaim.grounding,
          },
        ],
        sourceDraftCharacterLength: 200,
      }),
    );

    expect(result.verdict).toBe("pass");
  });

  it("rejects Condense when the result is not shorter", () => {
    const result = evaluateGrounding(
      actionInput({
        kind: "condense",
        sourceClaims,
        sourceDraftCharacterLength: 10,
      }),
    );

    expectRejectedFor(result, "condense-not-shorter");
  });

  it("allows Expand only when it preserves every source Claim and becomes longer", () => {
    const result = evaluateGrounding(
      actionInput(
        {
          kind: "expand",
          sourceClaims,
          sourceDraftCharacterLength: 10,
        },
        {
          candidate: serviceCandidate(
            "The service was attentive throughout my appointment.",
          ),
        },
      ),
    );

    expect(result.verdict).toBe("pass");
  });

  it("rejects an Expand that invents a discount", () => {
    const discountAssertion: GenerationAssertion = {
      ...parkingAssertion,
      id: "assertion-discount",
      version: "assertion-discount-v1",
      semanticId: "discount-available",
    };
    const discountCandidate: Candidate = {
      claims: [
        ...serviceCandidate().claims,
        {
          ...parkingClaim,
          id: "claim-discount",
          semanticId: "discount-available",
          text: "A discount was available.",
          grounding: [
            {
              kind: "assertion",
              assertionId: "assertion-discount",
              assertionVersion: "assertion-discount-v1",
            },
          ],
        },
      ],
      segments: [
        { kind: "claim", claimId: "claim-service" },
        { kind: "connector", text: " " },
        { kind: "claim", claimId: "claim-discount" },
      ],
    };

    const result = evaluateGrounding(
      actionInput(
        {
          kind: "expand",
          sourceClaims,
          sourceDraftCharacterLength: 10,
        },
        {
          candidate: discountCandidate,
          assertions: [serviceAssertion, discountAssertion],
        },
      ),
    );

    expectRejectedFor(result, "claim-added-by-transformation");
  });

  it("rejects an Expand that drops a source Claim", () => {
    const result = evaluateGrounding(
      actionInput({
        kind: "expand",
        sourceClaims: [
          ...sourceClaims,
          {
            semanticId: "parking-easy",
            grounding: parkingClaim.grounding,
          },
        ],
        sourceDraftCharacterLength: 10,
      }),
    );

    expectRejectedFor(result, "required-claim-missing");
  });

  it("rejects an Expand that preserves Claims but does not become longer", () => {
    const result = evaluateGrounding(
      actionInput({
        kind: "expand",
        sourceClaims,
        sourceDraftCharacterLength: 100,
      }),
    );

    expectRejectedFor(result, "expand-not-longer");
  });

  it("rejects Revise Wording when a presentation instruction becomes a fact", () => {
    const result = evaluateGrounding(
      actionInput(
        { kind: "revise-wording", sourceClaims },
        { candidate: twoClaimCandidate() },
      ),
    );

    expectRejectedFor(result, "claim-added-by-transformation");
  });

  it("accepts Paraphrase Assertions anchored to the immutable source revision", () => {
    const result = evaluateGrounding(
      actionInput({
        kind: "paraphrase",
        sourceRevisionId: "source-text-v1",
        allowedAssertionIds: ["assertion-service"],
        requiredSemanticIds: ["service-attentive"],
      }),
    );

    expect(result.verdict).toBe("pass");
  });

  it("rejects Paraphrase evidence anchored to another source revision", () => {
    const result = evaluateGrounding(
      actionInput({
        kind: "paraphrase",
        sourceRevisionId: "source-text-v2",
        allowedAssertionIds: ["assertion-service"],
        requiredSemanticIds: ["service-attentive"],
      }),
    );

    expectRejectedFor(result, "source-revision-mismatch");
  });

  it("lets Resample use the originating grounding set, not only the prior sample", () => {
    const result = evaluateGrounding(
      actionInput(
        {
          kind: "resample",
          allowedAssertionIds: ["assertion-service", "assertion-parking"],
          allowedContextFactIds: [],
        },
        { candidate: twoClaimCandidate() },
      ),
    );

    expect(result.verdict).toBe("pass");
  });

  it("rejects a derived Claim that swaps its original transitive grounding", () => {
    const result = evaluateGrounding(
      actionInput(
        { kind: "reformat", sourceClaims },
        {
          candidate: {
            claims: [
              {
                ...serviceCandidate().claims[0]!,
                grounding: parkingClaim.grounding,
              },
            ],
            segments: serviceCandidate().segments,
          },
        },
      ),
    );

    expectRejectedFor(result, "transitive-grounding-mismatch");
  });
});
