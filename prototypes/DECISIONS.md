# DECISIONS

Every ambiguity in the brief, resolved. One line each. Recorded in build order.

## Format and delivery

1. **Design Components, not bare `.html`** — this project builds every surface as a streaming `.dc.html` Design Component, so `survey.html`/`admin.html` are `Survey.dc.html`/`Admin.dc.html`; each opens directly in a browser and needs no build step, server or package manager.
2. **"Fully self-contained" is met per surface, not per byte** — fixtures, state machine, composition pipeline and all view markup live in the one file; the shared runtime (`support.js`) and the design-system bundle load beside it from the project folder rather than being inlined.
3. **No separate `.js`/`.css` of our own was written** — no helper module, no stylesheet; every style is inline, exactly as the design system's flat model expects.
4. **`gallery.html` and `index.html` are `Gallery.dc.html` and `Index.dc.html`** for the same reason.
5. **The design system is applied as instructed** — Maue tokens, type, radii, hairline rules, flat surfaces, no shadows, sentence case, no emoji. Nothing about the interaction spec was changed to suit it.

## State machines

6. **The survey exposes 19 addressable states, not 17** — the enumerated list in Part 6 yields 17 plus `results-grounding-stripped` (addressable in its own right because the gallery and the panel need to link to it) plus `verification-unavailable`, the terminal for the "no code" path the brief describes but does not name.
7. **The admin exposes 16** — the 13 named views plus the three edge conditions, of which `budget-warning` and `provider-degraded` render as banners over `overview`.
8. **Invalid `?state=`** renders the list of valid names as buttons that navigate, not a blank page and not a redirect.
9. **Deep links seed a demo session** where a state needs drafts that cannot exist yet (`results`, `refine`, `editing`, `done`, `generating`); interacting through the flow produces the same states from real input.
10. **`?fresh=1`** renders a state detached from the shared session and store — added so the gallery's ~40 embedded frames cannot overwrite each other or the user's own session.
11. **Session persists in `localStorage`, not `sessionStorage`**, so it survives a reload and a closed tab, as "survives reload" implies for a link a customer may return to.
12. **`?latency=` and `?fail=` are readable from the URL** as well as the toolbar, so a failure state can be linked to directly.

## Grounding and composition

13. **Draft text is composed from keyword labels themselves** rather than a separate `phrase` field, so adding a keyword in admin makes it usable in a draft with no other edit — the fixture shape in Part 4 stays exactly as specified.
14. **`FIXTURES.embellishments` was added** — the unsupported claims a live model attempts — so stripping can be demonstrated on live-composed drafts and not only on the stored `stripped` record.
15. **`FIXTURES.actionCatalog` was added** — per-action grounding rule, bound input and relative cost, taken verbatim from the table in Part 1, because the admin `actions` view must render them and the contract sketch had no home for them.
16. **`outcome: { status, editDistance }` was added to each generation record**, because `generation-detail` is required to show the recorded outcome and the contract's global `outcomes` object carries counts only.
17. **Stripping is deterministic, not random** — the first Generate run of a session attempts one unsupported claim, and every Expand attempts one; both are removed and reported. This is the realistic model behaviour and makes the central interaction reachable by walking the flow.
18. **Rejection is a real outcome of the pipeline** — a run whose claim set resolves to empty returns `groundingVerdict: "rejected"` with a null draft, rather than an error.
19. **Banned terms strip through the same path** as an unsupported claim, with the same visible notice and reason, so a policy removal is never silent either.
20. **Restore-by-typing appends the typed text as a claim** with `sourceSpan: "restored-by-typing"`; the removed wording is never placed in the field, never copied to the clipboard, and cannot be recovered from the UI.
21. **Condense drops whole claims** to reach the target rather than compressing two into one ambiguous sentence.
22. **Expand adds framing sentences and no claims**; the claim it attempts is stripped and shown, which is the demonstration the brief asks for.
23. **Refine records the instruction as a claim** with `sourceSpan: "instruction"`, visible in the survey's provenance list and in the generation record.
24. **Paraphrase reflows the customer's own sentences** and maps each to a character span; there is no model call in a prototype, and inventing a rewrite would misrepresent the action.
25. **A style's `maxChars` is enforced by dropping claims, never by truncating text** mid-fact; a customer's own edit may exceed it and is never blocked.
26. **Copy is not one of the seven actions** and is therefore not behind the tenant/style gate — it is the terminal action and is always available.

## Failures

27. **A real budget check runs before injected failures** — `monthToDateCostMicros >= monthlyBudgetMicros` routes to `budget-exceeded` regardless of the toolbar.
28. **`provider-error` fails on the initial attempt and the first retry, and succeeds on the second**, with `fallbackUsed: true` on the successful record — the brief's "first retry fails, second succeeds" read as a fallback demonstration.
29. **Retrying out of `rate-limited` clears the injected rate limit** once the countdown has elapsed; the window has passed, so failing again would be a lie.
30. **Countdown is 24 seconds** — long enough to read, short enough to sit through in a review.
31. **`budget-exceeded` shows no billing, quota or infrastructure language**, and its unaided textarea and copy button genuinely work.
32. **`not-configured` is reached from the flow** when a tenant has no active keywords, so deactivating every keyword in admin produces it in the survey.

## Tenancy and configuration

33. **Two tenants differ on identity, keywords, enabled styles, enabled actions, disclosure, verification, draft cap and budget**; `ironworks` enables four of the seven actions, so gating is observable rather than asserted.
34. **Tenant is a URL parameter persisted to `localStorage`** so both surfaces agree; the admin *login* deliberately has no tenant selector, and the tenant control in the harness is a development affordance, not product UI.
35. **Admin writes to the same store the survey reads**, and both listen for `storage` events, so a change is visible in an open survey tab without a reload as well as on next load.
36. **Saving business context increments `contextVersion`**; drafts already written keep the version they were written against.
37. **Editing a prompt creates a new hash at status `draft`**; nothing mutates, and the source version stays listed and addressable.
38. **A running experiment can only be stopped**, never edited; creating one while another runs is blocked with the reason stated.
39. **Manifest validation names the first offending field per rule** — `key`, `version`, `displayName`, `constraints.maxChars`, `constraints.emojiPolicy`, `supportedActions` — and a duplicate `key` is rejected as such.
40. **A valid manifest is also enabled for the current tenant on add**, so the new style appears in the survey immediately rather than needing a second step.
41. **New keyword ids are `<slug prefix>-k<timestamp>`**; ids are opaque and never shown to a customer.
42. **`emojiPolicy` values are `none` and `allowed`**; `micro` declares `allowed` purely to prove the constraint is configuration — no emoji appears anywhere, per the design system.

## Console detail

43. **The analytics date range scales `n` and cost by a fixed factor** per window; there is no time-series fixture and inventing one would be invented data.
44. **The alert threshold is console-only** and says so when changed.
45. **`generation-detail` reads the five fixture records**; survey runs are held in the session rather than written to a generation log, which a real implementation would do server-side.
46. **Bench's fake provider returns instantly at zero cost**, and every bench result states that it is excluded from analytics, experiments and billing.
47. **Bench requires a source generation for the actions that operate on a draft** and says so instead of silently running.
48. **`cross-tenant-404` returns not-found, never forbidden**, with an HTML comment recording that this is deliberate so resource existence is not disclosed.

## Implementation notes

49. **Streaming is per draft** — each pending region gets its own interval, scaled by its position, so concurrent drafts visibly finish at different times; abort clears every interval at once and returns with selections retained.
50. **Clipboard writes use `navigator.clipboard` when available**; `file://` may refuse it, so `done` also shows the final text in full for manual copying.
51. **The disclosure line is generated from the tenant's name** and is included in the copied text whenever `requireDisclosure` is set.
52. **Nothing anywhere posts, submits or publishes.** The only outbound path is a genuine `https://` anchor with `target="_blank"` and `rel="noopener"` that the customer chooses to follow.

## Revision R2 — entry model, locations, real multi-tenancy

53. **Configuration is modelled in three scopes — platform, tenant, location** — and the scope is rendered, not documented: every settings field carries a `PLATFORM` / `TENANT` / `LOCATION` badge, because the badge is the blast radius of the change the operator is about to make.
54. **The scope bar is console chrome, not a settings page** — `Platform › Tenant › Location` sits above every admin state, is always populated, and is the only place tenant or location changes. The old harness tenant switcher became a role switcher.
55. **Role is `FIXTURES.session.role`, and gating is enforced rather than implied** — `platform_admin` sees platform scope, `agency_operator` sees assigned tenants without it, `tenant_operator` sees one tenant and has no switcher. A platform state requested by a role that cannot hold platform scope is refused in `go()` and rewritten to `overview` on load.
56. **Ironworks is gone entirely.** `speicher-neun` differs structurally, not cosmetically: locale, keyword taxonomy, entry mode, verification feasibility, destinations, action set and disclosure posture.
57. **Keyword categories moved from a code enum to `tenant.keywordCategories`** — a dental practice's five categories and a restaurant's five German ones cannot be one enum. This is recorded in `SPEC.md` as a schema revision forced by the second tenant, and the tenant settings screen edits the taxonomy as data.
58. **Location keywords are additions, not a separate table** — the survey composes tenant set + location additions, the console shows both in one table with a scope badge, and adding one asks which scope owns it.
59. **Location inherits tenant policy; `overrides` records only what was changed** — reset deletes the override rather than copying the tenant value down, so a later tenant change still propagates.
60. **The link is the entry model** — `/s/<tenantSlug>/<locationSlug>?v=<visitToken>&t=<tableRef>`, simulated by `?tenant=`, `?location=`, `?v=`, `?t=` and displayed in the survey harness so tenant and location are visibly travelling in the URL.
61. **The harness defaults an invited tenant to a valid token**, because the common case is a validated visit; `verification` is reachable by choosing "no token (open)" and is framed as a fallback, not a step.
62. **`?t=` is validated against `/^[\w .-]{1,12}$/`** — the preview host also uses `?t=`, and a reference-shaped guard was cheaper than renaming the product's documented parameter.
63. **`entry-token-used` is a plain statement, not an error** — one invitation, one assisted draft, with the unaided route offered in the same breath. It is the anti-abuse control the incentive to farm reviews requires.
64. **`invalid-link` distinguishes unknown tenant, unknown location and unreadable token in copy only** — the three causes are switchable in the state itself, and none discloses which tenants or venues exist.
65. **`done` routes on `location.destinations × style.targetPlatform`** — the matching destination is listed first and marked as shaped for that format; all destinations remain available, and every URL is built from the id held against that venue.
66. **Place ids are fixtures, so the outbound links are searches carrying the place id** rather than canonical profile URLs. A real deployment substitutes the profile URL; inventing one here would fabricate a business.
67. **Style manifests gained `targetPlatform` and `locale`, and `description`/`sample` became locale maps** — a manifest at `locale: "any"` is enabled by both tenants and therefore cannot carry one language's copy. The map is the smallest honest change to the manifest shape.
68. **A style whose locale matches neither `"any"` nor the tenant is never offered and cannot be enabled** — the survey names what it withheld, and the tenant enablement screen blocks the checkbox with the reason.
69. **Style keys were renamed to the manifest names in the brief** — `concise` → `concise-blurb`, `detailed` → `detailed-narrative`, `micro` → `social-short` — and the stored generations and analytics rows were migrated with them.
70. **Analytics is keyed by tenant and carries `locationSlug`** — the two venues of one tenant show different numbers, and one scope selector drives overview and analytics alike: this venue, this tenant broken down by venue, or every visible tenant.
71. **`FIXTURES.outcomes` was dropped** — the overview now derives run count, weighted acceptance and cost from the scoped analytics rows, so changing scope visibly moves the numbers instead of showing a constant.
72. **The QR is a labelled placeholder and the download is inert**, tied to the platform flag `distribution.qrDownload`, which is off. A rendered-but-unscannable code in a print pack would be a lie.
73. **The store key moved to `v2`** — the shape gained `platform`, `locations`, `locationSlug` and `role`, and a half-loaded v1 store would fail silently.
74. **German copy is authored, not machine-translated, and limited to the customer-facing survey** — the ask, rating question and words, trust statement, both entry paths, the minimum-selection message, keyword headings, format screen, the grounding-stripped notice, the disclosure line and `done`. Structural English remains on operator-facing labels and on survey chrome the brief did not enumerate.
75. **Four German strings beyond the brief's fixture list were authored and are logged here**: the two location keyword additions (`Tisch direkt am Wasser`, `Kein Tisch ohne Reservierung`), the disclosure line, and the two printed-placement previews on `distribution`. Each exists because the feature is illegible without data on both tenants.
76. **The admin console stays in English at every locale** — it is an operator surface for one vendor, and a half-translated console would be worse than an untranslated one. Logged as a gap rather than filled with invented German.
77. **Provisioning copies the platform policy template into a new tenant record** and gives it one location and no keywords, so a freshly provisioned tenant's survey correctly renders `not-configured`.
78. **The price table keeps superseded rows with `effectiveFrom`**, so a generation priced under an older row can be re-costed exactly rather than approximately.
79. **The survey now exposes 20 states and the console 23 views** — `entry-token-used` is new; `settings` split into `settings-tenant`, `settings-location` and `platform-settings`; `platform-tenants`, `platform-providers`, `platform-styles`, `locations` and `distribution` are new.
