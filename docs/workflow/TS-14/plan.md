# TS-14 plan

## Outcome

Implement the Review Format Manifest system according to ADR-004:
1. Zod schemas in `packages/contracts` (`StyleManifestDtoSchema`, `FewShotExampleDtoSchema`, `PromptFragmentsDtoSchema`).
2. Pure validation, catalogue checks, built-in definitions (`concise-blurb`, `detailed-narrative`, `social-short`), and contract test kit in `packages/domain`.
3. Safe max-length enforcement by dropping whole claims rather than mid-word truncation.
4. Authoring tutorial in `docs/AUTHORING-A-STYLE.md`.

## Public seam

- `packages/contracts/context`: `StyleManifestDtoSchema`, `StyleManifestDto`
- `packages/domain/review-format`:
  - `validateFormatManifest`
  - `validateFormatManifestCatalogue`
  - `canEnableFormatForTenant`
  - `BUILT_IN_FORMATS` / `getBuiltInFormat`
  - `runFormatContractTests`
  - `enforceMaxCharsByDroppingWholeClaims`
