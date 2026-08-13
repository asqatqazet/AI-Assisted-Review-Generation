# TS-02 plan

## Outcome

Make ADR-004 and the accepted admission amendment executable in CI. Architecture rules cover imports,
transitive reachability, sealed package entrypoints, and the two import-free escape hatches that graph
analysis cannot observe.

## Enforcement seams

- dependency-cruiser for workspace, deployable, DB-role, Node built-in, and external-package edges;
- a Domain-only TypeScript project without DOM or Node globals;
- ESLint restrictions for global network/configuration access;
- package exports and TypeScript path maps for sealed public feature entrypoints.

A rule is accepted only after a deliberate violating consumer produces a named failure and the clean
workspace returns to green.

