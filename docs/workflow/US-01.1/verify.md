# US-01.1 verification

## Frontend dependency-boundary drill

A temporary production file imported `apps/web-bff/src/app.ts` from the frontend.

Before the new rule:

```text
✔ no dependency violations found (66 modules, 78 dependencies cruised)
```

With `web-frontend-cannot-reach-server-or-runtime-packages` enabled:

```text
error web-frontend-cannot-reach-server-or-runtime-packages:
apps/web-bff/src/frontend/dependency-violation.ts → apps/web-bff/src/app.ts
```

The rule also reported the reachable paths to BFF server modules and `packages/domain`. The temporary
file was then deleted:

```text
✔ no dependency violations found (65 modules, 77 dependencies cruised)
```

The story-level `pnpm verify` result is recorded when the remaining US-01.1 acceptance slices are done.
