import { describe, expect, it } from "vitest";

import { runGoldenEvaluation } from "./runner.js";

describe("TS-19 Golden-Set Evaluation Gate", () => {
  it("scores the golden set scenarios with 100% grounding pass rate", () => {
    const report = runGoldenEvaluation("evals/golden");

    expect(report.totalScenarios).toBeGreaterThanOrEqual(20);
    expect(report.failedScenarios).toBe(0);
    expect(report.passRate).toBe(1.0);
    expect(report.results.every((r) => r.passed)).toBe(true);
  });
});
