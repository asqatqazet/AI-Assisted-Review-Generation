# TS-04 persistence notes

This is the non-TDD persistence half of TS-04. The pure configuration resolver remains a separate TDD change. `docs/agents/domain.md` is normative when the older System Design sketch or prototype fixtures use compatibility names.

## Scope ownership

Platform-owned catalogue tables deliberately have no `tenant_id`: Platform Settings, Provider/Provider Model, Price Rate, Feature Flag, Action Definition, Review Format Version, Posting Destination Type, Entry Mode Definition, Operator Role Definition, and Prompt Template Version. Provider rows store only a credential reference; provider credentials do not enter configuration snapshots.

`Tenant` is the isolation-root row. Every Tenant-owned or Tenant-attributed child table has a non-null `tenant_id`, including grants, configuration, admission, generation, grounding, Draft, and Disposition records. `Operator` is a Platform identity; `TenantAccessGrant` is the revocable Tenant-owned membership relation. `Location` is a configuration scope inside a Tenant, not a separate security boundary.

The schema uses the canonical names:

- Fact Option Category and immutable Fact Option Version, not keyword/category enums;
- Review Format Version and Review Format Enablement, not executable style plugins;
- Review Session, not a bare session or survey session;
- Claim and Unsupported Output as separate records;
- immutable Generation output and separately revisioned Draft text;
- Disposition for accepted, edited, or discarded Drafts.

The compatibility actions `restyle` and `refine` do not become ambiguous database values. `REFORMAT` is canonical. Refine is represented by the normalized `REVISE_WORDING` and `ADD_FACT` commands described by the domain model; a wire adapter may translate compatibility keys only after validating the appropriate input contract.

## Structural isolation

Tenant attribution is repeated intentionally. Composite unique keys and foreign keys make these relationships invalid at the database boundary:

- a Location belonging to a different Tenant;
- a Visit or Invitation Token crossing Tenant/Location scope;
- Assertions, Source Text Revisions, Generations, Claims, Drafts, or Dispositions crossing Review Sessions;
- a source Generation or source Claim crossing the originating Review Session;
- an Experiment Variant using another Tenant's Prompt Version;
- a Generation using another Tenant's Prompt Version or a snapshot from another Location;
- a Claim grounding itself in an Assertion from another Review Session;
- a selected Draft Revision belonging to a different Draft.

`tenant_id` indexes are present now so TS-05 can add fail-closed RLS policies without changing query shape. This migration intentionally contains no RLS policy, role, or grant.

## Configuration and immutable evidence

- `locations.overrides` is the only Location override store and must be a JSON object. Absence means inheritance; reset deletes a key.
- Fact Option Versions have exactly one owner scope. A Tenant option has no `location_id`; a Location addition must have one. A selection records the exact immutable version.
- Prompt Template Version is Platform-owned. Prompt Version is always Tenant-owned and may name the template it derived from. Mutable deployment/evaluation state is not stored on the content version.
- Effective Configuration Snapshot self-binds `tenant_id`, `location_id`, `schema_version`, and `content_hash`, and stores resolved payload plus per-field provenance. Generation references the snapshot id, not a Tenant-only context version.
- Generation also references the exact Prompt Version and Review Format Version. Generation Batch captures one normalized request, its Assertion set, idempotency key, request hash, and Budget Reservation; multiple requested formats become separate Generations in that batch.
- Provider Attempt records the exact Provider Model, request/response, usage, and the Price Rate used when billed. This permits fallback calls to retain their own rate and cost rather than pretending a multi-attempt Generation used one price row.
- Generation output and Claim records are distinct from Draft and Draft Revision. Reviewer edits never mutate provider output.

## SQL constraints beyond Prisma's schema language

The initial migration adds checks that Prisma cannot express, including source-specific Assertion shapes, Fact Option owner shape, money/token/rating ranges, billed-attempt shape, and Draft Disposition shape.

Two deferred constraint triggers protect aggregate/cross-row invariants at transaction commit:

1. An invited Review Session must use the Invitation Token's exact Tenant, Location, and Visit, and the token must be marked consumed in the same transaction.
2. Every Claim must retain at least one direct Assertion or permitted verified-context grounding; a parent Claim alone is not sufficient.

`pgcrypto` supplies UUID defaults and `citext` gives Operator email case-insensitive uniqueness.

## Sealed database adapters

The one Prisma schema generates three clients into separate internal paths:

- `src/generated/control-plane` for `@review/db/control-plane`;
- `src/generated/admission` for `@review/db/admission`;
- `src/generated/execution-plane` for `@review/db/execution-plane`.

They are generation targets, not public package exports. ADR-004 still prohibits a root DB export, a shared generic client, or arbitrary transaction/query APIs. TS-05 must pair each adapter with its own non-owner database role and disjoint grants; generated TypeScript types are not an authorization boundary.

## Remaining limitations and later enforcement

These constraints are not honestly enforceable by Prisma relations alone:

1. **RLS and grants:** TS-05 must add `ENABLE` plus `FORCE ROW LEVEL SECURITY`, matching `USING`/`WITH CHECK`, non-owner/non-`BYPASSRLS` runtime roles, and disjoint grants for control-plane, admission, and execution-plane clients.
2. **Immutable rows:** Prisma cannot declare a model append-only. Sealed repositories must expose no content-update path for Prompt/Review Format/Fact Option versions, snapshots, Generations, Claims, Source Text Revisions, or Draft Revisions. TS-05 grants or a later migration may additionally deny updates or add immutability triggers.
3. **Lineage ordering and acyclicity:** composite foreign keys keep source Generation and Claim links in one Review Session and reject direct self-links, but cannot prove that a source is earlier or that an arbitrary chain is acyclic. The execution-plane append transaction must check both.
4. **Fact Option Location applicability:** one composite FK proves the selected option belongs to the Tenant. Because Tenant-wide options intentionally have a null Location while Location additions do not, a single ordinary FK cannot also prove that a Location-owned option matches the Review Session's Location. The admission/domain operation must check this, and TS-06 should include a wrong-Location case.
5. **Semantic pairing:** ordinary foreign keys cannot prove that an Experiment, Prompt Version, Action Definition, Review Format supported-action list, Generation Batch, and Generation all name the same Action. Domain construction validates this before persistence.
6. **Experiment weights:** row checks bound each weight to 0–10,000 basis points, but the sum across active Variants requires a transactional aggregate check.
7. **Price intervals and totals:** the schema rejects duplicate start instants and invalid intervals, but does not exclude every possible overlapping Price Rate interval. Nor can it prove that Generation totals equal all billed Provider Attempts. Billing construction and TS-11/TS-16 tests must establish those propositions; a PostgreSQL exclusion constraint can be added if concurrent rate editing becomes real.
8. **Span semantics:** a Source Text Assertion records a non-empty non-negative span and exact immutable revision, but a check constraint cannot compare the end offset to text length in another row. Domain validation must do so.
9. **Atomic admission:** the unique Invitation Token link plus deferred trigger protects the committed shape, but only the sealed admission transaction can make token consumption, Review Session creation, and signed capability issuance one atomic operation. A token row can otherwise be marked consumed without creating a session.
10. **Canonical hashes:** the database stores and keys content hashes; TS-07 owns canonical serialization, hash calculation, and the rule that any effective Generation input changes snapshot identity.

Because Prisma does not introspect check constraints or trigger bodies into `schema.prisma`, future generated migrations must preserve the hand-written constraints in this initial migration. Drift review must inspect SQL, not only the Prisma model diff.
