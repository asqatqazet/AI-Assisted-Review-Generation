export interface BudgetEvaluationInput {
  readonly monthToDateCostMicros: number;
  readonly budgetMicros: number;
  readonly estimatedCostMicros: number;
  readonly alertThresholdPct?: number | undefined;
}

export type BudgetEvaluation =
  | {
      readonly allow: true;
      readonly alertThresholdReached: boolean;
    }
  | {
      readonly allow: false;
      readonly reason: "budget-exceeded";
      readonly retryAfterSeconds: number;
    };

export function evaluateBudget(input: BudgetEvaluationInput): BudgetEvaluation {
  const projectedCost = input.monthToDateCostMicros + input.estimatedCostMicros;

  if (projectedCost > input.budgetMicros) {
    return {
      allow: false,
      reason: "budget-exceeded",
      retryAfterSeconds: 3600, // Suggest retry next hour / after budget reset
    };
  }

  const alertThreshold = input.alertThresholdPct ?? 80;
  const currentRatioPct = (input.monthToDateCostMicros / input.budgetMicros) * 100;
  const alertThresholdReached = currentRatioPct >= alertThreshold;

  return {
    allow: true,
    alertThresholdReached,
  };
}
