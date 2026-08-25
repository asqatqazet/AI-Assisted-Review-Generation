import { describe, expect, it } from "vitest";

import {
  assignExperimentVariant,
  canQualifyPromptVersionAsCandidate,
  canPromoteToExperiment,
  derivePromptVersionHash,
  transitionPromptVersionStatus,
  validateExperiment,
  type ExperimentDefinition,
  type PromptVersionRecord,
} from "./experiment.js";

describe("TS-18 Prompt Versioning & Experiments", () => {
  it("generates deterministic content-addressed sha256 prompt version hashes", () => {
    const hash1 = derivePromptVersionHash({
      key: "review.generate",
      commandKind: "generate",
      body: "Draft an authentic review.",
      variables: ["locale", "tone"],
    });

    // Reordered variables array should be sorted canonically
    const hash2 = derivePromptVersionHash({
      key: "review.generate",
      commandKind: "generate",
      body: "Draft an authentic review.",
      variables: ["tone", "locale"],
    });

    expect(hash1).toBe(hash2);
    expect(hash1.startsWith("sha256:")).toBe(true);

    // Whitespace difference in body generates a distinct version hash
    const hash3 = derivePromptVersionHash({
      key: "review.generate",
      commandKind: "generate",
      body: "Draft an authentic review. ",
      variables: ["tone", "locale"],
    });

    expect(hash3).not.toBe(hash1);
  });

  it.each([
    {
      name: "an ASCII Prompt",
      input: {
        key: "review.generate",
        commandKind: "generate" as const,
        body: "Draft an authentic review.",
        variables: ["tone", "locale"],
      },
      expected:
        "sha256:deffc5649f7ab05cd9b87db254ce61a577786bf702bd1f33af94bf07b8c985ec",
    },
    {
      name: "a non-ASCII Prompt",
      input: {
        key: "review.emoji",
        commandKind: "generate" as const,
        body: "Write about café 😊.",
        variables: ["locale", "tone"],
      },
      expected:
        "sha256:6f9e388d0621dce20987cb5909fac6f1c4aeac344a5150e91edc3a0fb43c4780",
    },
  ])("emits the canonical SHA-256 digest for $name", ({ input, expected }) => {
    const hash = derivePromptVersionHash(input);

    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(hash).toBe(expected);
  });

  it("enforces prompt version status lifecycle transitions", () => {
    const draft: PromptVersionRecord = {
      hash: "sha256:111",
      key: "review.generate",
      commandKind: "generate",
      body: "Body",
      variables: [],
      status: "draft",
    };

    const candidate = transitionPromptVersionStatus(draft, "candidate");
    expect(candidate.status).toBe("candidate");

    const inExperiment = transitionPromptVersionStatus(
      candidate,
      "in-experiment",
    );
    expect(inExperiment.status).toBe("in-experiment");

    const retired = transitionPromptVersionStatus(inExperiment, "retired");
    expect(retired.status).toBe("retired");

    // Illegal transitions: draft -> in-experiment directly
    expect(() => transitionPromptVersionStatus(draft, "in-experiment")).toThrow(
      /Illegal status transition/i,
    );

    // Candidate is an append-only decision for immutable Prompt content.
    expect(() => transitionPromptVersionStatus(candidate, "draft")).toThrow(
      /Illegal status transition/i,
    );

    // Illegal transition: retired -> candidate
    expect(() =>
      transitionPromptVersionStatus(retired, "candidate"),
    ).toThrow(/Illegal status transition/i);
  });

  it("validates experiment variant weights total exactly 100", () => {
    const validExp: ExperimentDefinition = {
      id: "exp-1",
      tenantId: "tenant-a",
      action: "generate",
      status: "draft",
      variants: [
        { variantKey: "control", promptVersionHash: "sha256:111", weightPct: 50 },
        { variantKey: "challenger", promptVersionHash: "sha256:222", weightPct: 50 },
      ],
    };

    expect(() => validateExperiment(validExp)).not.toThrow();

    const invalidExp: ExperimentDefinition = {
      ...validExp,
      variants: [
        { variantKey: "control", promptVersionHash: "sha256:111", weightPct: 40 },
        { variantKey: "challenger", promptVersionHash: "sha256:222", weightPct: 50 },
      ],
    };

    expect(() => validateExperiment(invalidExp)).toThrowError(
      /weights must total exactly 100/i,
    );
  });

  it("requires at least two distinct Prompt Versions with positive whole weights", () => {
    const base: ExperimentDefinition = {
      id: "exp-1",
      tenantId: "tenant-a",
      action: "generate",
      status: "draft",
      variants: [
        { variantKey: "control", promptVersionHash: "sha256:111", weightPct: 50 },
        { variantKey: "challenger", promptVersionHash: "sha256:222", weightPct: 50 },
      ],
    };

    expect(() =>
      validateExperiment({
        ...base,
        variants: [
          { variantKey: "control", promptVersionHash: "sha256:111", weightPct: 100 },
        ],
      }),
    ).toThrowError(/at least two/i);

    expect(() =>
      validateExperiment({
        ...base,
        variants: [
          { variantKey: "control", promptVersionHash: "sha256:111", weightPct: 50 },
          { variantKey: "challenger", promptVersionHash: "sha256:111", weightPct: 50 },
        ],
      }),
    ).toThrowError(/distinct Prompt Versions/i);

    expect(() =>
      validateExperiment({
        ...base,
        variants: [
          { variantKey: "control", promptVersionHash: "sha256:111", weightPct: -10 },
          { variantKey: "challenger", promptVersionHash: "sha256:222", weightPct: 110 },
        ],
      }),
    ).toThrowError(/positive whole percentage/i);
  });

  it("enforces promotion gate requiring 100% grounding pass rate", () => {
    const promptInput = {
      key: "review.generate",
      commandKind: "generate" as const,
      body: "Body",
      variables: [],
    };
    const prompt: PromptVersionRecord = {
      ...promptInput,
      hash: derivePromptVersionHash(promptInput),
      status: "candidate",
    };

    // 100% pass rate
    expect(
      canPromoteToExperiment(prompt, { passRate: 1.0, evaluatedCases: 20 }),
    ).toBe(true);

    // 95% pass rate fails gate
    expect(() =>
      canPromoteToExperiment(prompt, { passRate: 0.95, evaluatedCases: 20 }),
    ).toThrowError(/grounding pass rate of 100%/i);
  });

  it("qualifies a canonical evaluated Draft before it can be published or experimented", () => {
    const promptInput = {
      key: "review.generate",
      commandKind: "generate" as const,
      body: "Body",
      variables: [] as const,
    };
    const draft: PromptVersionRecord = {
      ...promptInput,
      hash: derivePromptVersionHash(promptInput),
      status: "draft",
    };

    expect(
      canQualifyPromptVersionAsCandidate(draft, {
        passRate: 1,
        evaluatedCases: 20,
      }),
    ).toBe(true);
    expect(() =>
      canQualifyPromptVersionAsCandidate(
        { ...draft, status: "candidate" },
        { passRate: 1, evaluatedCases: 20 },
      ),
    ).toThrowError(/Draft/i);
  });

  it("rejects promotion without an evaluated case or from a non-candidate lifecycle state", () => {
    const promptInput = {
      key: "review.generate",
      commandKind: "generate" as const,
      body: "Body",
      variables: [] as const,
    };
    const candidate: PromptVersionRecord = {
      ...promptInput,
      hash: derivePromptVersionHash(promptInput),
      status: "candidate",
    };

    expect(() =>
      canPromoteToExperiment(candidate, {
        passRate: 1,
        evaluatedCases: 0,
      }),
    ).toThrowError(/at least one evaluated case/i);

    expect(() =>
      canPromoteToExperiment(
        { ...candidate, status: "draft" },
        { passRate: 1, evaluatedCases: 22 },
      ),
    ).toThrowError(/candidate/i);
  });

  it("rejects promotion when the stored Prompt hash does not identify its content", () => {
    const prompt: PromptVersionRecord = {
      key: "review.generate",
      commandKind: "generate",
      body: "Body",
      variables: [],
      hash: `sha256:${"0".repeat(64)}`,
      status: "candidate",
    };

    expect(() =>
      canPromoteToExperiment(prompt, { passRate: 1, evaluatedCases: 22 }),
    ).toThrowError(/content hash/i);
  });

  it("deterministically assigns experiment variants using session id bucketing", () => {
    const exp: ExperimentDefinition = {
      id: "exp-1",
      tenantId: "tenant-a",
      action: "generate",
      status: "running",
      variants: [
        { variantKey: "control", promptVersionHash: "sha256:111", weightPct: 50 },
        { variantKey: "challenger", promptVersionHash: "sha256:222", weightPct: 50 },
      ],
    };

    const variantA = assignExperimentVariant("sess-abc-123", exp);
    const variantB = assignExperimentVariant("sess-abc-123", exp);

    expect(variantA.variantKey).toBe(variantB.variantKey);
    expect(variantA.promptVersionHash).toBe(variantB.promptVersionHash);
  });
});
