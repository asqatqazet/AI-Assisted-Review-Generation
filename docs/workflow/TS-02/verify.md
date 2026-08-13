# TS-02 violation drill

Executed on 2026-08-13. Every temporary source file was removed immediately after its failure was
captured. None is present in the commit.

## Cross-deployable import

```text
error web-bff-workspace-dependencies:
  apps/web-bff/src/violation-cross-deployable.ts → apps/context-service/src/main.ts
error web-bff-cannot-import-other-deployables:
  apps/web-bff/src/violation-cross-deployable.ts → apps/context-service/src/main.ts
x 2 dependency violations
```

A same-app consumer was then tested:

```text
✔ no dependency violations found (18 modules, 2 dependencies cruised)
```

This proves the explicit rules permit locality inside a deployable while rejecting a remote seam
implemented as an import.

## Domain workspace dependency

```text
error domain-no-workspace-dependencies:
  packages/domain/src/generation/violation-workspace.ts → packages/llm/src/index.ts
error domain-never-imports-db-or-llm:
  packages/domain/src/generation/violation-workspace.ts → packages/llm/src/index.ts
```

## Domain Node I/O import

```text
error domain-no-node-builtins:
  packages/domain/src/generation/violation-io.ts → fs
```

## Domain global I/O without an import

```text
packages/domain/src/generation/violation-global-io.ts
  1:26  error  Unexpected use of 'fetch'  no-restricted-globals

TS2304: Cannot find name 'fetch'.
```

Both independent gates fail: lint states the architectural reason and the Domain-only compiler proves
the global is unavailable.

## BFF database reachability

```text
error web-bff-workspace-dependencies:
  apps/web-bff/src/violation-db.ts → packages/db/src/execution-plane/index.ts
error web-bff-cannot-reach-db:
  apps/web-bff/src/violation-db.ts → packages/db/src/execution-plane/index.ts
```

## Generation configuration-reader edge

```text
error generation-cannot-reach-context-client-contracts:
  apps/generation-service/src/violation-config.ts → packages/contracts/src/context/index.ts
```

## Generation configuration read without an import

```text
apps/generation-service/src/violation-config-global.ts
  1:26  error  'process.env' is restricted from being used.
  Generation configuration is an explicit function parameter; environment reads are forbidden in
  production source.  no-restricted-properties
```

## Context crossing into execution persistence

```text
error context-db-imports-control-and-admission-only:
  apps/context-service/src/violation-db-role.ts → packages/db/src/execution-plane/index.ts
```

## Execution persistence crossing into Admission

```text
error db-execution-plane-cannot-reach-admission:
  packages/db/src/execution-plane/violation-admission.ts → packages/db/src/admission/index.ts
```

## Contracts importing something other than Zod

Because pnpm uses isolated dependencies, Hono is not resolvable from Contracts at all:

```text
error not-to-unresolvable:
  packages/contracts/src/shared/violation-external.ts → hono
```

The explicit `contracts-external-dependencies-are-zod-only` rule additionally rejects any resolvable
external dependency other than Zod.

## Sealed feature entrypoints

```text
apps/web-bff/src/violation-deep-import.ts(1,8): error TS2882:
Cannot find module or type declarations for side-effect import of '@review/domain/internal'.
```

## Clean result

After all violations were removed, `pnpm verify` passed lint, the Domain purity compiler, workspace
typecheck, dependency-cruiser, unit, integration, and all eight builds.

