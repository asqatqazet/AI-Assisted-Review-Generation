# TS-02 · Architectural fitness functions

**Scope:** infra · **Size:** S · **TDD:** not applicable · **Depends on:** TS-01

## Story

As the author of an agent-written codebase, I need the architecture's rules enforced by the build, so
that an agent that has forgotten a boundary is stopped by CI rather than by my attention.

## Context

`AGENTS.md` prose is a suggestion. A failing build is a rule. This story is the difference between
claiming an "AI-agent friendly engineering system" and having one — and it is the cheapest pillar-4
evidence in the whole project.

## Acceptance criteria

- [ ] `.dependency-cruiser.cjs` committed, wired into `pnpm verify` and CI, encoding:
  - `packages/domain` may not import `db`, `llm`, `plugins`, `observability`, or any I/O built-in
    (`node:fs`, `node:net`, `node:http`, `node:crypto` is permitted for hashing)
  - the raw Prisma client may be imported only by `packages/db/src/tenant-context.ts`
  - `apps/web` may not import `packages/db` at all
  - `apps/generation-service` may not import configuration-owning modules from `packages/db`
  - `packages/contracts` may not import anything but zod
- [ ] For **each** rule: a deliberate violation is introduced, CI is shown failing, and the violation
      is reverted. Evidence recorded in `docs/workflow/TS-02/verify.md` with the failing output pasted
- [ ] `AGENTS.md` states that these invariants are enforced by CI, not by memory, and names the file

## Technical notes

- Prefer `dependency-cruiser` over ESLint import rules — it understands the workspace graph and its
  error messages name the offending edge, which is what an agent needs to self-correct.
- The `node:crypto` carve-out exists because content-addressed prompt hashing (TS-18) is pure. Document
  it inline; an unexplained exception is how a rule dies.
- Keep the rule set small. Five enforced rules beat fifteen aspirational ones.

## Out of scope

The RLS coverage test (TS-06) and the provider registry test (TS-13). Those are runtime invariants and
live with their subjects.

## Definition of done — extra

The violation drill is the deliverable, not the config file. A rule that has never been seen to fail is
not known to work.

## Harness prompt

```
Read stories/TS-02-architectural-fitness-functions.md and ADR-004 if it exists.

Write .dependency-cruiser.cjs encoding the five rules listed in the acceptance criteria, and wire it
into pnpm verify and CI.

Then, for each rule in turn: introduce a deliberate violation, run pnpm verify, capture the failing
output, and revert. Paste all five failures into docs/workflow/TS-02/verify.md.

Do not report this story done on the basis that the config file exists. It is done when I can read
five real failures.

Finally, add a section to AGENTS.md stating that these invariants are enforced by CI rather than by
the agent's memory, and naming the config file so an agent that trips one knows where to look.
```
