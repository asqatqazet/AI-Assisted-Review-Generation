# TS-08 plan

## Outcome

Build pure, deterministic prompt composition in `packages/domain` that unites Effective Configuration Snapshot, Review Format manifest, Prompt Version, and Action inputs into model messages and strict JSON output schemas.

## Public seam

- `composePrompt(input): ComposedPrompt`
- `OUTPUT_SCHEMA`
- `ComposePromptInput`, `PromptMessage`, `ComposedPrompt`
