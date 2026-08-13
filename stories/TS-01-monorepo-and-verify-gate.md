# TS-01 · Monorepo, strict TypeScript, one verify gate

**Scope:** infra · **Size:** M · **TDD:** not applicable · **Depends on:** — · **Blocks:** everything

## Story

As an engineer working mostly through agents, I need a single command that proves the repository is
healthy, so that no agent can report success it did not earn and every later story has one gate to pass.

## Context

The assignment evaluates operability and maintainability from repository evidence, not slogans. A
`pnpm verify` that runs everything is the cheapest form of that evidence, and it is what every
subsequent story's definition of done points at.

Stack is fixed by the brief: Node 24 LTS, pnpm, TypeScript, NX.

## Acceptance criteria

- [ ] `pnpm install && pnpm dev` boots web + both services + Postgres with no undocumented steps
- [ ] NX workspace with three apps (`web`, `context-service`, `generation-service`) and six packages
      (`domain`, `contracts`, `llm`, `plugins`, `db`, `observability`)
- [ ] TypeScript `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`
      at the root, inherited by every project
- [ ] `docker-compose.yml` runs Postgres 16; connection string read from env with an `.env.example`
- [ ] `pnpm verify` runs, in order: lint → typecheck → dependency-cruiser → unit → integration → build
- [ ] `pnpm verify` fails loudly if any stage fails; no stage is allowed to be advisory
- [ ] GitHub Actions runs `pnpm verify` on every push, with the badge in `README.md`
- [ ] A fresh clone on a machine with only Node and Docker reaches green

## Technical notes

- NX task graph, not npm scripts chained by hand — the caching matters at four-day pace.
- `packages/domain` gets its own vitest project with **no** setup file and no container dependency.
  It must run in under a second; that is what makes red-green-refactor bearable.
- Integration tests use testcontainers, tagged so they can be excluded locally but never in CI.
- Do not add a formatter argument to the gate. Formatting is a pre-commit concern; a verify gate that
  fails on whitespace trains people to ignore it.

## Out of scope

Application logic of any kind. Fitness function rules (TS-02). Prisma schema (TS-04).

## Harness prompt

```
Read 01-SYSTEM-DESIGN.md §6 and stories/TS-01-monorepo-and-verify-gate.md.

Scaffold the NX + pnpm + TypeScript monorepo described there. Three apps, six packages, Postgres via
docker-compose, and a single `pnpm verify` running lint → typecheck → dependency-cruiser → unit →
integration → build in that order.

TypeScript must be strict, including noUncheckedIndexedAccess and exactOptionalPropertyTypes. Fix the
errors those flags produce rather than relaxing them.

packages/domain must have a vitest project that runs with no containers and no setup file, in under a
second on an empty suite.

Add the GitHub Actions workflow running pnpm verify on push.

Write no application logic. This story ends when a fresh clone reaches a green verify.
```
