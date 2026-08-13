# Assisted Review Generation

![verify](https://github.com/asihati/AI-Assited-Review-Generation/actions/workflows/verify.yml/badge.svg)

An assisted review-writing system that turns only reviewer-confirmed assertions into grounded drafts.

## Local development

Prerequisites: Node 24, pnpm, and Docker.

```sh
cp .env.example .env
pnpm install
pnpm dev
```

The walking skeleton exposes:

- web + BFF: `http://localhost:3000/health`
- Context: `http://localhost:3001/health`
- Generation: `http://localhost:3002/health`

Run the same non-advisory gate used in CI:

```sh
pnpm verify
```

Nx orders the gate as lint → typecheck → dependency-cruiser → unit → integration → build.
