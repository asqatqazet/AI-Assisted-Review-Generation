# TS-09 plan

## Outcome

Make unsafe model output unpersistable through one pure guard that proves structural Claim coverage,
evidence identity, same-Review-Session provenance, and command-specific postconditions.

## Public seam

`evaluateGrounding(input)` receives a structured Candidate, immutable Assertions/permitted context, and
one normalized command postcondition. It returns either:

- `pass`, with the same Candidate and a rendered Draft body; or
- `rejected`, with no Candidate/Draft bytes and customer-safe reason records.

Candidate prose can exist only in Claim segments. Connector segments accept punctuation and whitespace
only, closing the usual “untracked intro/outro sentence” bypass.

