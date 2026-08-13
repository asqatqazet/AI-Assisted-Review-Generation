# TS-07 review

## Behavioral evidence

- Equal semantic configuration produces equal canonical bytes and a `sha256:` snapshot identity.
- Changes to an effective value, provenance-bearing override, Fact Option ordering, Prompt Version,
  Review Format Version, Provider route, or Price Rate change snapshot identity.
- Set-like inputs are normalized while semantically ordered Fact Options preserve resolved ordering.
- Only enabled, locale-compatible Review Format Versions enter the snapshot.
- Provider credentials and undeclared caller fields cannot enter the allowlisted snapshot shape.
- The result is deeply frozen and input arrays/objects remain unmodified.

