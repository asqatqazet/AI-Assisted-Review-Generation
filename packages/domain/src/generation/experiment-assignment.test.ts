import { describe, expect, it } from "vitest";

import { assignVariant, type WeightedVariant } from "./experiment-assignment.js";

const variants: readonly WeightedVariant[] = [
  { key: "control", weightPercent: 50 },
  { key: "concise", weightPercent: 30 },
  { key: "warm", weightPercent: 20 },
];

describe("assignVariant", () => {
  it("returns the same assignment over 1,000 repeated calls", () => {
    const first = assignVariant("session-42", "generate-prompt", variants);

    for (let repeat = 0; repeat < 1_000; repeat += 1) {
      expect(assignVariant("session-42", "generate-prompt", variants)).toBe(
        first,
      );
    }
  });

  it("keeps a 10,000-session distribution within two percentage points", () => {
    const counts = new Map(variants.map(({ key }) => [key, 0]));

    for (let sequence = 0; sequence < 10_000; sequence += 1) {
      const assigned = assignVariant(
        `session-${sequence}`,
        "generate-prompt",
        variants,
      );
      counts.set(assigned, (counts.get(assigned) ?? 0) + 1);
    }

    for (const variant of variants) {
      const actualPercent = (counts.get(variant.key) ?? 0) / 100;
      expect(actualPercent).toBeGreaterThanOrEqual(variant.weightPercent - 2);
      expect(actualPercent).toBeLessThanOrEqual(variant.weightPercent + 2);
    }
  });

  it("always selects the only positive-weight variant", () => {
    expect(
      assignVariant("session-1", "single", [
        { key: "only", weightPercent: 100 },
      ]),
    ).toBe("only");
  });

  it("never selects a zero-weight variant", () => {
    const weighted: readonly WeightedVariant[] = [
      { key: "eligible", weightPercent: 100 },
      { key: "disabled", weightPercent: 0 },
    ];

    for (let sequence = 0; sequence < 1_000; sequence += 1) {
      expect(assignVariant(`session-${sequence}`, "zero", weighted)).toBe(
        "eligible",
      );
    }
  });

  it.each([
    { name: "under 100", variants: [{ key: "a", weightPercent: 99 }] },
    {
      name: "over 100",
      variants: [
        { key: "a", weightPercent: 50 },
        { key: "b", weightPercent: 51 },
      ],
    },
  ])("rejects weights that sum $name", ({ variants: invalid }) => {
    expect(() => assignVariant("session-1", "invalid", invalid)).toThrowError(
      expect.objectContaining({ code: "invalid-variant-weights" }),
    );
  });

  it("does not move an assignment between existing variants when one is added", () => {
    const before: readonly WeightedVariant[] = [
      { key: "a", weightPercent: 50 },
      { key: "b", weightPercent: 50 },
    ];
    const after: readonly WeightedVariant[] = [
      { key: "a", weightPercent: 40 },
      { key: "b", weightPercent: 40 },
      { key: "new", weightPercent: 20 },
    ];

    for (let sequence = 0; sequence < 10_000; sequence += 1) {
      const sessionId = `session-${sequence}`;
      const oldAssignment = assignVariant(sessionId, "stable", before);
      const newAssignment = assignVariant(sessionId, "stable", after);

      expect(newAssignment === "new" || newAssignment === oldAssignment).toBe(
        true,
      );
    }
  });

  it("separates assignments for different experiments", () => {
    const firstExperiment = Array.from({ length: 100 }, (_, sequence) =>
      assignVariant(`session-${sequence}`, "experiment-a", variants),
    );
    const secondExperiment = Array.from({ length: 100 }, (_, sequence) =>
      assignVariant(`session-${sequence}`, "experiment-b", variants),
    );

    expect(secondExperiment).not.toEqual(firstExperiment);
  });
});
