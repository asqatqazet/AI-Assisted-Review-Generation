# TS-18 review

## Behavioral evidence

- Prompt versions are content-addressed using canonical JSON SHA-256 hashing; variable ordering does not alter hash, whereas body whitespace changes produce distinct hashes.
- Prompt status lifecycle (`draft -> candidate -> in-experiment -> retired`) enforces illegal transition rejections.
- Experiment validation strictly requires variant weights to sum to 100%.
- Promotion gate in the domain requires 100% grounding pass rate before a prompt version can be attached to a running experiment.
- Experiment variant assignment is deterministic per `reviewSessionId`.
