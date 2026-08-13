# TS-18 plan

## Outcome

Implement prompt versioning (content-addressed SHA-256 hashes, status lifecycle) and experiment variant management with weight total validation, deterministic session bucketing, and 100% grounding promotion gate in `packages/domain/src/experiment/`.

## Public seam

- `derivePromptVersionHash(input): "sha256:..."`
- `transitionPromptVersionStatus(current, targetStatus): PromptVersionRecord`
- `validateExperiment(experiment): void`
- `canPromoteToExperiment(prompt, evalResult): boolean`
- `assignExperimentVariant(reviewSessionId, experiment): ExperimentVariant`
