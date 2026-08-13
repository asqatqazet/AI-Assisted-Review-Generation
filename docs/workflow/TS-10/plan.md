# TS-10 plan

## Outcome

Build a pure domain Policy Engine module that evaluates compliance rules:
1. Dynamic generation and attachment of disclosure notices from Tenant identity and locale.
2. Draft request allowance and cap enforcement.
3. Verification requirement determination with compile/run-time rejection of contradictory configurations (e.g. open-qr with verified experience requirement).
4. Action availability calculation as the intersection of tenant-enabled and review-format-supported commands, returning actionable reasons for excluded actions.

## Public seam

- `applyPolicy({ draft, claims, policy, tenantName, locale })`
- `generateDisclosureNotice(tenantName, locale)`
- `canRequestDraft({ policy, draftsThisSession })`
- `requiresVerification({ policy, entryMode, tokenPresent })`
- `availableActions({ tenantEnabled, styleSupported })`
- `ContradictoryPolicyError`
