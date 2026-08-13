# TS-01 plan

## Outcome

Establish an Nx + pnpm + TypeScript workspace whose public commands are `pnpm dev` and
`pnpm verify`.

ADR-004 supersedes the stale six-package story sketch. The workspace therefore contains three
deployables (`web-bff`, `context-service`, `generation-service`) and five packages (`domain`,
`contracts`, `llm`, `db`, `observability`). Review Formats are data, not an executable plugin
package.

## Public verification seams

- `pnpm install --frozen-lockfile`
- `pnpm exec nx show projects`
- `pnpm verify`
- health responses from ports 3000, 3001 and 3002 when the serve targets run
- Postgres 16 readiness through Docker Compose on a Docker-capable host

## Implementation notes

The Nx `workspace:verify` target owns task ordering. It is a dependency chain, not a shell-script
chain: lint → typecheck → dependency-cruiser → unit → integration → build. Every stage is mandatory.

