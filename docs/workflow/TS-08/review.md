# TS-08 review

## Behavioral evidence

- Composition is deterministic: identical inputs produce byte-identical messages.
- The output schema demands structured draft and claims with assertion IDs.
- For derived actions (`reformat`, `condense`, `expand`, `revise-wording`), the ceiling constraint is embedded exclusively in the system message.
- Tone guidelines, banned terms, locale-mapped descriptions, format constraints, and few-shot examples are assembled consistently without branching forks.
- Pure domain implementation with zero external I/O.
