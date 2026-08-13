# TS-12 verification

## Focused behavior

```sh
pnpm exec vitest run packages/llm/src/model-gateway.test.ts
```

Result: 14 tests passed. The cases cover complete scripted runs, all eight failure codes, exhausted
scripts, injected latency, pre-call cancellation, in-flight cancellation, and failed-attempt
evidence. The suite imports only Vitest and `@review/llm`; it opens no network seam.

## Package checks

```sh
pnpm exec eslint packages/llm/src
pnpm exec tsc --ignoreConfig --noEmit --target ES2023 \
  --lib ES2023,DOM,DOM.Iterable --module NodeNext --moduleResolution NodeNext \
  --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes \
  --noImplicitOverride --noFallthroughCasesInSwitch \
  --noPropertyAccessFromIndexSignature --useUnknownInCatchVariables \
  --verbatimModuleSyntax --isolatedModules --skipLibCheck packages/llm/src/index.ts
pnpm exec depcruise packages/llm --config .dependency-cruiser.cjs --output-type err
pnpm exec tsup packages/llm/src/index.ts --format esm --out-dir dist/packages/llm --clean
```

Result: lint and strict production typecheck passed; dependency-cruiser found no violations across
four modules and five dependency edges; the ESM build succeeded.

The workspace-wide TypeScript command was also attempted. At this point it was blocked by an
unrelated concurrent TS-07 test fixture: `config-snapshot.test.ts` supplies an intentionally forbidden
`apiKey` property to the statically typed `ProviderRouting` value. TS-12 itself has no workspace
typecheck error.
