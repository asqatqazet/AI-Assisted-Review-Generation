# TS-02 review

## Corrections made

- Replaced a malformed capture/backreference rule with explicit rules for each deployable.
- Added Context's Admission adapter without exposing it to Generation or the execution adapter.
- Removed dormant required rules aimed at files that did not exist; parameter position will be enforced
  by the public Generation interface and compile-time consumer tests when that interface lands.
- Closed Domain against import-free I/O with an independent compiler project and lint rules.
- Closed Generation production source against direct network and environment configuration reads.
- Replaced wildcard package exports with the named ADR-004 feature entrypoints.
- Assigned runtime dependencies to their actual pnpm workspace owners.

## Limits stated honestly

Dependency-cruiser cannot prove that a TypeScript value occurs in a required parameter position and it
cannot see all dynamically constructed network access. The compiler interface tests and restricted
production globals cover those different properties; no single tool is claimed to prove all three.

