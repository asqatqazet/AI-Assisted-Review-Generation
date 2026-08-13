# TS-19 plan

## Outcome

Implement deterministic golden-set evaluation harness in `evals/golden/*.json` and `evals/runner.ts` scoring scenarios against 100% grounding requirement, style constraints, disallowed terms, and output schemas.

## Public seam

- `evals/golden/*.json` (22 scenarios across tenants, styles, actions, and adversarial cases)
- `evals/runner.ts` (`runGoldenEvaluation`, `evaluateScenario`)
- `evals/results/latest.json`
- `pnpm eval:golden`
