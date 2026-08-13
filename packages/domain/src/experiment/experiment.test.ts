import { describe, expect, it } from "vitest";

import {
  assignExperimentVariant,
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

  it("enforces promotion gate requiring 100% grounding pass rate", () => {
    const prompt: PromptVersionRecord = {
      hash: "sha256:111",
      key: "review.generate",
      commandKind: "generate",
      body: "Body",
      variables: [],
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
