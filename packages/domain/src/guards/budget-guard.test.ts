import { describe, expect, it } from "vitest";

import {
  evaluateBudget,
  type BudgetEvaluationInput,
} from "./budget-guard.js";

describe("TS-20 Budget Guard", () => {
  it("allows generation when cost estimate is safely under budget", () => {
    const input: BudgetEvaluationInput = {
      monthToDateCostMicros: 500_000,
      budgetMicros: 1_000_000,
      estimatedCostMicros: 50_000,
      alertThresholdPct: 80,
    };

    const result = evaluateBudget(input);
    expect(result.allow).toBe(true);
    if (result.allow) {
      expect(result.alertThresholdReached).toBe(false);
    }
  });

  it("flags alertThresholdReached when monthToDateCost exceeds threshold percentage", () => {
    const input: BudgetEvaluationInput = {
      monthToDateCostMicros: 850_000,
      budgetMicros: 1_000_000,
      estimatedCostMicros: 10_000,
      alertThresholdPct: 80,
    };

    const result = evaluateBudget(input);
    expect(result.allow).toBe(true);
    if (result.allow) {
      expect(result.alertThresholdReached).toBe(true);
    }
  });

  it("denies generation when estimated cost crosses budget line", () => {
    const input: BudgetEvaluationInput = {
      monthToDateCostMicros: 990_000,
      budgetMicros: 1_000_000,
      estimatedCostMicros: 20_000, // 990k + 20k = 1.01M > 1M
    };

    const result = evaluateBudget(input);
    expect(result.allow).toBe(false);
    if (!result.allow) {
      expect(result.reason).toBe("budget-exceeded");
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
    }
  });

  it("denies generation when monthToDateCost is exactly at budget", () => {
    const input: BudgetEvaluationInput = {
      monthToDateCostMicros: 1_000_000,
      budgetMicros: 1_000_000,
      estimatedCostMicros: 1,
    };

    const result = evaluateBudget(input);
    expect(result.allow).toBe(false);
  });

  it("allows generation when monthToDateCost + estimate is exactly at budget", () => {
    const input: BudgetEvaluationInput = {
      monthToDateCostMicros: 999_999,
      budgetMicros: 1_000_000,
      estimatedCostMicros: 1,
    };

    const result = evaluateBudget(input);
    expect(result.allow).toBe(true);
  });
});
