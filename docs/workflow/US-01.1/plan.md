# US-01.1 plan

Authority: `docs/adr/ADR-004-package-boundaries.md`, `docs/adr/ADR-005-student-assessment-target.md`,
`docs/agents/domain.md`, `docs/SYSTEM-ARCHITECTURE.md`, then `stories/EPICS.md`.

## Confirmed seams

The owner previously approved the project seams and on 2026-08-17 directed implementation against the
accepted architecture. Tests for this story cross only these documented public interfaces:

1. **Browser route seam:** given `/start/:entryChallengeHandle`, `/review/:reviewSessionHandle`, or
   `/console/*`, the React application exposes the expected accessible page projection through the DOM.
2. **Static artifact seam:** Vite emits an `index.html` plus hashed browser assets; the artifact contains
   no prototype HTML/fixture runtime or production state/identity query harness.
3. **Dependency seam:** production frontend source can import its own frontend modules and contract DTOs,
   but cannot reach BFF server modules, Node built-ins, domain, DB, LLM, or observability.

The first tracer bullet covers one observable behavior only: the clean Start route renders a production
reviewer shell without loading a prototype surface. Later tests add the Review and Console routes,
responsive/accessibility behavior, artifact inspection, and the deliberate dependency violation.
