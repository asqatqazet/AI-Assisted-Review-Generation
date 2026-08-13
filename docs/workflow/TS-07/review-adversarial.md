# TS-07 adversarial review

The story's abbreviated `contextVersion` output was rejected: a Tenant counter cannot bind Location
overrides or per-field provenance. The canonical result uses a content-derived `snapshotId` and embeds
both Tenant and Location identity.

The story's suggested `node:crypto` exception was also rejected because the accepted package boundary
makes Domain independent of Node. SHA-256 is implemented as a deterministic pure calculation and its
known-vector behavior is covered by the snapshot tests.

Credentials remain a deployment secret even if a structurally compatible caller object happens to
carry them. The snapshot is constructed as an allowlist rather than serialized by object spreading.

