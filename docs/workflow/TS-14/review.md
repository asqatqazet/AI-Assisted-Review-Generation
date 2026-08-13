# TS-14 review

## Behavioral evidence

- Manifest validation rejects invalid structures and reports the first offending field per rule.
- Duplicate keys in a catalogue are rejected with an explicit duplicate key error.
- Locale compatibility checks verify format support against Tenant locale or `"any"`.
- Built-in formats exhibit distinct structural constraints; `social-short` (<= 140 chars) strictly forbids `expand`.
- The contract test kit tests schema conformance, constraint invariants, and post-processor purity.
- `enforceMaxCharsByDroppingWholeClaims` drops entire unasserted claims instead of slicing text mid-sentence.
