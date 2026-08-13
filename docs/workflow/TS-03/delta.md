# TS-03 prototype-to-contract delta

The prototypes remain interaction evidence, but ADR-004 and `docs/agents/domain.md` are authoritative
for domain language and safety. The following deviations are intentional and visible.

| Prototype field/concept | Contract treatment | Reason |
|---|---|---|
| `keyword` / `Keyword` | `FactOptionVersionDto`; fixture parser is `PrototypeKeywordDto` | A configured option is not an Assertion until selected. |
| `style` / `StyleManifest` | `ReviewFormatVersionDto`; fixture parser is `PrototypeStyleManifestDto` | “Style” conflated tone and the target review shape. Review Format is canonical. |
| seven `GenerationAction` values | six semantic commands plus separate `ResampleGenerationCommandDto` | Regenerate is resampling, Restyle is Reformat, and fact-bearing Refine is an Add Assertion flow. |
| `Refine.instruction` as evidence | `ReviseWording.presentationInstruction` only | An instruction is not automatically reviewer evidence. |
| `Claim { sourceKeywordId | sourceSpan | null }` | `ClaimDto.grounding[]` is non-empty and discriminated | Null provenance made unsupported output inhabit the Claim type. |
| `removedClaims` | `UnsupportedOutputDto`, audit-only | Rejected wording is not a Claim and is never returned in reviewer-facing events. |
| `groundingVerdict: clean | stripped | rejected` | `pass | rejected` | Unsafe text is never exposed as a partially repaired Draft. |
| `contextVersion` | self-bound `snapshotId` plus `schemaVersion`, Tenant and Location | Tenant-only counters cannot identify effective Location configuration. |
| `outcome` | `DispositionDto` | Outcome was an overloaded projection; Disposition is the reviewer decision. |
| `draft` embedded on Generation | separate `DraftDto` in the terminal event | Generation is immutable provider work; Draft revisions are reviewer-editable. |
| provider `credential` in Platform fixture | excluded from `EffectiveConfigurationSnapshotDto` and `PublicSurveyContextDto` | Credentials are deployment secrets, not configuration or browser data. |
| Prompt `status` and `evalScore` | absent from immutable `PromptVersionDto` | Deployment/evaluation lifecycle is separate mutable state. |
| `Experiment` | compatibility parser only | Experiments were deferred until one-provider correctness, budgets, and safety gates are earned. |
| `fallbackUsed` | immutable `ProviderAttemptDto[]` | Every retry/repair/provider call has separate provenance and cost. |

Fixture-shaped records remain parseable through the `Prototype*Dto` schemas for migration and explicit
mapping. New production interfaces do not use those names.

