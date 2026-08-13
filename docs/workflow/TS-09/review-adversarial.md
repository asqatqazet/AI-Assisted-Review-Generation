# TS-09 adversarial review

The story's requested `pass | stripped | rejected` mutation path was rejected. Removing individual
strings and continuing would require re-running Claim coverage, grounding, policy, and Review Format
validation and could silently alter meaning. An unsafe Candidate is rejected whole; repair is a new,
separately recorded Provider Attempt.

`removedClaims` is likewise not returned to the reviewer. Rejected model wording is Unsupported Output
for restricted audit only and is filtered by the service response contract.

Restore-by-typing was deleted. Reviewer edits create a Draft Revision; a new fact becomes evidence only
after an explicit Add Assertion flow. Arbitrary typed text cannot mint a grounded Claim.

Banned terms are Policy, not grounding evidence. TS-10 validates them after grounding and the pipeline
re-runs both guards before persistence.

This deterministic guard proves structural provenance and closed-set command semantics. It does not
pretend that a model-authored `semanticId` proves natural-language entailment. Semantic faithfulness is
measured through adversarial evaluation and can later add a conservative deterministic recognizer; an
LLM judge is not a hard safety invariant.

