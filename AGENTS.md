# Agent operating contract

## Authority

Use this precedence when artifacts disagree:

1. accepted ADRs in `docs/adr/`;
2. the canonical domain model in `docs/agents/domain.md`;
3. corrected story outcomes in `stories/`;
4. prototype interaction behavior;
5. obsolete implementation sketches in `01-SYSTEM-DESIGN.md`.

Compatibility DTOs may preserve prototype field names at a wire seam. Domain code uses the canonical
language from `docs/agents/domain.md`.

## Verification

`pnpm verify` is the only completion gate. It must remain non-advisory and preserve this order:
lint → typecheck → dependency-cruiser → unit → integration → build.

Architecture is enforced by `.dependency-cruiser.cjs`, not by agent memory. Do not weaken a rule to
make a change pass; change the dependency direction or amend the accepted ADR explicitly.

## Testing

Tests cross confirmed public seams only. TDD stories proceed one observable behavior at a time:
failing test, minimum implementation, green test. Do not mock modules owned by this repository; use
real pure interfaces, real Postgres for persistence behavior, and fakes only at external seams.
