# Assisted Review Generation

![verify](https://github.com/asqatqazet/AI-Assisted-Review-Generation/actions/workflows/verify.yml/badge.svg)

An assisted review-writing system that turns only reviewer-confirmed assertions into grounded drafts.

## Design

- [Accepted student assessment system and AWS architecture](docs/SYSTEM-ARCHITECTURE.md)
- [Zero-budget hosting facts and primary sources](docs/research/ZERO-BUDGET-HOSTING.md)
- [Accepted product Epics and prototype traceability](stories/EPICS.md)
- [Canonical domain language and invariants](docs/agents/domain.md)
- [Accepted package boundaries](docs/adr/ADR-004-package-boundaries.md)
- [Student deployment execution guide](docs/STUDENT-DEPLOYMENT-GUIDE.md)

## Local development

Prerequisites: Node 24, pnpm, and Docker.

```sh
cp .env.example .env
pnpm install
pnpm dev
```

The walking skeleton exposes:

- browser UI: `http://127.0.0.1:5173/`
- synthetic review entry: `http://127.0.0.1:5173/s/demo-tenant/demo-location`
- BFF health: `http://127.0.0.1:3000/health`
- Context health: `http://127.0.0.1:3001/health`
- Generation health: `http://127.0.0.1:3002/health`

Run the same non-advisory gate used in CI:

```sh
pnpm verify
```

Nx orders the gate as lint → typecheck → dependency-cruiser → unit → integration → browser → build.
