import { describe, expect, it } from "vitest";

import {
  evaluateGrounding,
  type Candidate,
  type GenerationAssertion,
  type GroundingEvaluationInput,
} from "./grounding-guard.js";

const assertion = (
  overrides: Partial<GenerationAssertion> = {},
): GenerationAssertion => ({
  id: "assertion-service",
  version: "assertion-service-v1",
  reviewSessionId: "review-session-a",
  semanticId: "service-attentive",
  semanticKind: "experience-fact",
  polarity: "positive",
  source: {
    kind: "fact-option",
    factOptionId: "fact-service",
    factOptionVersion: "fact-service-v1",
  },
  ...overrides,
});

const candidate = (overrides: Partial<Candidate> = {}): Candidate => ({
  claims: [
    {
      id: "claim-service",
      semanticId: "service-attentive",
      semanticKind: "experience-fact",
      polarity: "positive",
      text: "The service was attentive",
      grounding: [
        {
          kind: "assertion",
          assertionId: "assertion-service",
          assertionVersion: "assertion-service-v1",
        },
      ],
    },
  ],
  segments: [
    { kind: "claim", claimId: "claim-service" },
    { kind: "connector", text: "." },
  ],
  ...overrides,
});

const input = (
  overrides: Partial<GroundingEvaluationInput> = {},
): GroundingEvaluationInput => ({
  reviewSessionId: "review-session-a",
  candidate: candidate(),
  assertions: [assertion()],
  permittedContextFacts: [],
  postcondition: {
    kind: "generate",
    allowedAssertionIds: ["assertion-service"],
    allowedContextFactIds: [],
  },
  ...overrides,
});

describe("evaluateGrounding complete coverage", () => {
  it("passes and renders a completely claimed candidate", () => {
    expect(evaluateGrounding(input())).toEqual({
      verdict: "pass",
      candidate: candidate(),
      draftBody: "The service was attentive.",
    });
  });

  it("rejects an empty Candidate as a normal outcome", () => {
    const result = evaluateGrounding(
      input({ candidate: { claims: [], segments: [] } }),
    );

    expect(result).toMatchObject({
      verdict: "rejected",
      candidate: null,
      draftBody: null,
      reasons: [{ code: "empty-candidate" }],
    });
  });

  it("rejects a Claim segment whose Claim is absent", () => {
    const result = evaluateGrounding(
      input({
        candidate: {
          claims: [],
          segments: [{ kind: "claim", claimId: "missing-claim" }],
        },
      }),
    );

    expect(result).toMatchObject({
      verdict: "rejected",
      reasons: [{ code: "unknown-claim-segment" }],
    });
  });

  it("rejects a Claim that does not appear in the Draft segments", () => {
    const result = evaluateGrounding(
      input({ candidate: { ...candidate(), segments: [] } }),
    );

    expect(result).toMatchObject({
      verdict: "rejected",
      reasons: expect.arrayContaining([{ code: "unrendered-claim" }]),
    });
  });

  it("rejects prose smuggled through a connector", () => {
    const result = evaluateGrounding(
      input({
        candidate: {
          ...candidate(),
          segments: [
            { kind: "claim", claimId: "claim-service" },
            { kind: "connector", text: " and parking was free." },
          ],
        },
      }),
    );

    expect(result).toMatchObject({
      verdict: "rejected",
      reasons: [{ code: "unsafe-connector" }],
    });
  });

  it("allows punctuation and whitespace as non-propositional connectors", () => {
    const result = evaluateGrounding(
      input({
        candidate: {
          ...candidate(),
          segments: [
            { kind: "claim", claimId: "claim-service" },
            { kind: "connector", text: ".\n\n" },
          ],
        },
      }),
    );

    expect(result.verdict).toBe("pass");
  });

  it("rejects duplicate Claim identities", () => {
    const oneClaim = candidate().claims[0];
    expect(oneClaim).toBeDefined();
    const result = evaluateGrounding(
      input({
        candidate: {
          ...candidate(),
          claims: [oneClaim!, { ...oneClaim!, text: "Duplicated" }],
        },
      }),
    );

    expect(result).toMatchObject({
      verdict: "rejected",
      reasons: [{ code: "duplicate-claim-id" }],
    });
  });

  it("rejects empty Claim text", () => {
    const claim = candidate().claims[0];
    const result = evaluateGrounding(
      input({
        candidate: { ...candidate(), claims: [{ ...claim!, text: "  " }] },
      }),
    );

    expect(result).toMatchObject({
      verdict: "rejected",
      reasons: [{ code: "empty-claim-text" }],
    });
  });

  it("does not return rejected candidate wording in the safe result", () => {
    const result = evaluateGrounding(
      input({
        candidate: {
          ...candidate(),
          segments: [{ kind: "connector", text: "A secret discount exists" }],
        },
      }),
    );

    expect(result.verdict).toBe("rejected");
    if (result.verdict === "rejected") {
      expect(result.candidate).toBeNull();
      expect(result.draftBody).toBeNull();
      expect(JSON.stringify(result.reasons)).not.toContain("secret discount");
    }
  });
});

describe("evaluateGrounding evidence integrity", () => {
  it("rejects a Claim without a grounding reference", () => {
    const claim = candidate().claims[0];
    const result = evaluateGrounding(
      input({
        candidate: {
          ...candidate(),
          claims: [{ ...claim!, grounding: [] }],
        },
      }),
    );

    expect(result).toMatchObject({
      verdict: "rejected",
      reasons: [{ code: "missing-grounding" }],
    });
  });

  it("rejects an Assertion from another Review Session", () => {
    const result = evaluateGrounding(
      input({ assertions: [assertion({ reviewSessionId: "review-session-b" })] }),
    );

    expect(result).toMatchObject({
      verdict: "rejected",
      reasons: [{ code: "cross-session-assertion" }],
    });
  });

  it("rejects an Assertion version mismatch", () => {
    const result = evaluateGrounding(
      input({ assertions: [assertion({ version: "assertion-service-v2" })] }),
    );

    expect(result).toMatchObject({
      verdict: "rejected",
      reasons: [{ code: "assertion-version-mismatch" }],
    });
  });

  it("rejects an Assertion outside the normalized request grounding set", () => {
    const result = evaluateGrounding(
      input({
        postcondition: {
          kind: "generate",
          allowedAssertionIds: [],
          allowedContextFactIds: [],
        },
      }),
    );

    expect(result).toMatchObject({
      verdict: "rejected",
      reasons: [{ code: "assertion-not-allowed" }],
    });
  });

  it("rejects an invented staff member with no Assertion", () => {
    const claim = candidate().claims[0];
    const result = evaluateGrounding(
      input({
        candidate: {
          claims: [
            {
              ...claim!,
              id: "claim-staff",
              semanticId: "staff-alice",
              text: "Alice was wonderful",
              grounding: [],
            },
          ],
          segments: [{ kind: "claim", claimId: "claim-staff" }],
        },
      }),
    );

    expect(result).toMatchObject({
      verdict: "rejected",
      reasons: [{ code: "missing-grounding" }],
    });
  });

  it("rejects an invented price with no Assertion", () => {
    const claim = candidate().claims[0];
    const result = evaluateGrounding(
      input({
        candidate: {
          claims: [
            {
              ...claim!,
              id: "claim-price",
              semanticId: "price-20-eur",
              text: "It cost €20",
              grounding: [],
            },
          ],
          segments: [{ kind: "claim", claimId: "claim-price" }],
        },
      }),
    );

    expect(result).toMatchObject({
      verdict: "rejected",
      reasons: [{ code: "missing-grounding" }],
    });
  });

  it("rejects polarity that contradicts a selected negative Fact Option", () => {
    const result = evaluateGrounding(
      input({
        assertions: [assertion({ polarity: "negative" })],
      }),
    );

    expect(result).toMatchObject({
      verdict: "rejected",
      reasons: [{ code: "grounding-polarity-conflict" }],
    });
  });

  it("does not let a rating ground an experience fact", () => {
    const ratingAssertion = assertion({
      semanticId: "rating-sentiment",
      semanticKind: "rating-sentiment",
      source: { kind: "rating", rating: 5 },
    });
    const result = evaluateGrounding(input({ assertions: [ratingAssertion] }));

    expect(result).toMatchObject({
      verdict: "rejected",
      reasons: [{ code: "grounding-kind-conflict" }],
    });
  });

  it("accepts an exactly versioned permitted context fact", () => {
    const claim = candidate().claims[0];
    const contextCandidate: Candidate = {
      claims: [
        {
          ...claim!,
          semanticId: "location-name",
          semanticKind: "verified-context",
          polarity: "neutral",
          grounding: [
            { kind: "verified-context", contextFactId: "location-name", version: "v3" },
          ],
        },
      ],
      segments: [{ kind: "claim", claimId: "claim-service" }],
    };

    const result = evaluateGrounding(
      input({
        candidate: contextCandidate,
        assertions: [],
        permittedContextFacts: [
          {
            id: "location-name",
            version: "v3",
            reviewSessionId: "review-session-a",
            semanticId: "location-name",
            semanticKind: "verified-context",
            polarity: "neutral",
          },
        ],
        postcondition: {
          kind: "generate",
          allowedAssertionIds: [],
          allowedContextFactIds: ["location-name"],
        },
      }),
    );

    expect(result.verdict).toBe("pass");
  });

  it("rejects a stale context-fact version", () => {
    const claim = candidate().claims[0];
    const result = evaluateGrounding(
      input({
        candidate: {
          claims: [
            {
              ...claim!,
              semanticKind: "verified-context",
              grounding: [
                { kind: "verified-context", contextFactId: "location-name", version: "v2" },
              ],
            },
          ],
          segments: candidate().segments,
        },
        assertions: [],
        permittedContextFacts: [
          {
            id: "location-name",
            version: "v3",
            reviewSessionId: "review-session-a",
            semanticId: "service-attentive",
            semanticKind: "verified-context",
            polarity: "positive",
          },
        ],
        postcondition: {
          kind: "generate",
          allowedAssertionIds: [],
          allowedContextFactIds: ["location-name"],
        },
      }),
    );

    expect(result).toMatchObject({
      verdict: "rejected",
      reasons: [{ code: "context-version-mismatch" }],
    });
  });
});
