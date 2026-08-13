# TS-20 plan

## Outcome

Implement pure budget guard and sliding-window rate limiter in `packages/domain/src/guards/`, along with structured logging with draft text redaction and CloudWatch EMF metric emission in `packages/observability/`.

## Public seam

- `evaluateBudget(input): BudgetEvaluation`
- `evaluateRateLimit(input): RateLimitEvaluation`
- `redactDraftText(obj): Record<string, unknown>`
- `logStructured(logData): void`
- `emitGenerationMetric(metric): void`
