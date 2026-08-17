# ADR-005: Student assessment target and fenced Generation execution

- **Status:** Accepted
- **Date:** 2026-08-17
- **Amends:** ADR-004's one-shot remote-port sketch

The owner accepted D1-D12 and D0's recommended scope in `docs/SYSTEM-ARCHITECTURE.md` as the implementation
target. The original assignment source is still absent, so whether it mandates both live providers or the
deferred Console/experiment features remains an explicit assumption and US-00.1 cannot yet be completed.

The assessment uses React/Vite behind the Hono BFF, the three existing deployables, PostgreSQL with forced
RLS, and the zero-budget `eu-central-1` topology documented in the architecture. Public strict-$0 operation
uses FakeProvider; OpenAI and Gemini adapters are enabled only with separately approved credit. Prototype
fixtures, client-supplied Tenant identity, unguarded candidate streaming, automatic provider failover and
the historical public-service Function URLs are not production behavior.

The accepted AWS capacity policy has two explicit deployment profiles. `reserved-concurrency` retains the
5/2/5/1 function reservations and therefore requires at least 113 regional concurrency. The assessment
default is `student-low-quota`: it requires the new-account floor of 10 unreserved executions and omits all
function reservations, while preserving the account-level hard ceiling. This is accepted only for the
access-restricted synthetic/FakeProvider release; it provides no per-function starvation isolation and
cannot enable a paid provider. Preflight, Terraform input and release output must record the same profile.

ADR-004's dependency directions remain unchanged, but its illustrative one-shot `GenerationPort.execute`
is replaced by the paid-work protocol. The BFF-owned `ContextPort` prepares entry/admission, prepares a
Generation Batch and signed child permits, activates a verified lease receipt, settles a verified terminal
receipt, and supports reconciliation. The BFF-owned `GenerationPort` prepares a finite execution lease,
executes only after a short-lived Context activation, and reports signed status/cancellation evidence.
Context and Generation still never import or call one another, and Generation still receives the complete
Effective Configuration Snapshot as a required value with no configuration-reading path.

Immediately before provider I/O, Generation must use database time and a compare-and-set transition to
claim exactly one pre-reserved Attempt ordinal. A replay, concurrent loser, expired lease, unactivated
lease, or delayed invocation cannot call a provider. Context releases or settles reservations only from
cryptographically separated Generation receipts. This additional handshake is accepted because a one-shot
call cannot simultaneously prevent duplicate paid work and safely reclaim crashes across the disjoint
database roles.
