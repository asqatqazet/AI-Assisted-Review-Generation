# TS-01 review

## Accepted findings

- Runtime dependencies were moved from the root to their consuming workspace packages.
- Nx analytics was disabled so a first run is non-interactive.
- GitHub Actions installs pnpm before asking setup-node to configure its pnpm cache.
- Local Postgres is bound to 127.0.0.1 rather than all host interfaces.
- Test globals were removed from production TypeScript compilation.

## Deferred to TS-02 by story boundary

The adversarial review found that the existing dependency-cruiser configuration needs explicit
cross-deployable rules, admission-subpath rules, non-import I/O protection, sealed package exports,
and witnessed violation drills. Those are architectural fitness behavior and are the entire scope of
TS-02; TS-01 does not claim them complete.

## Known environment limitation

This host does not have Docker installed. The Compose file and CI Postgres service are present, but the
local `pnpm dev` → Docker boot could not be executed here. All three Nx serve targets were started and
their public health responses were verified independently.

