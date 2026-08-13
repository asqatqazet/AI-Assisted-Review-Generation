# Assisted review writing — interaction prototypes

**These prototypes are the interaction source of truth for the implementation.** Where a screen here
and a written specification disagree, the screen is correct. They are built to be argued with, not
admired: every state, every failure, every configuration gate is reachable and exercisable.

## The product, in four sentences

The product helps a real customer write their own review. It never invents one — the customer
supplies the facts and the model only arranges, restates or restyles them. It never publishes on
anyone's behalf: the terminal action is copy, plus an outbound link the customer chooses to follow.
An unsupported claim is removed, the removal is shown, and it can only come back if the customer
types it themselves.

## Files

| File | What it is |
|---|---|
| `Index.dc.html` | Catalog: the three surfaces, the seven actions, every valid `?state=` value. Start here. |
| `Survey.dc.html` | End-user flow, mobile-first, 19 addressable states. |
| `Admin.dc.html` | Operator console, desktop and tabular, 16 addressable views. |
| `Gallery.dc.html` | Every state of both surfaces, live, labelled, each linking to its deep link. |
| `DECISIONS.md` | Every ambiguity resolved, one line each. |

Open any file directly in a browser. No server, no install, no build step. Each surface carries its
own `FIXTURES` block and its own state machine — the duplication between the two files is deliberate.

## How to drive them

- `?state=<name>` opens any state directly; an unknown value lists the valid ones.
- `?tenant=brightsmile|ironworks` switches tenant; the choice persists so both surfaces agree.
- `?toolbar=off` hides the development harness; `&fresh=1` renders detached from the shared session.
- The harness (bottom of each surface) carries the tenant selector, a state jump list, latency
  (`instant · 800ms · 3s · 12s`), failure injection (`provider-error · rate-limited ·
  budget-exceeded · grounding-rejected`), replay and reset.

## The seven actions

One pipeline, seven input bindings, seven grounding rules.

| Action | Bound input | New claims permitted |
|---|---|---|
| Generate | Asserted keywords + optional free text | Only claims tracing to an asserted keyword or the free text |
| Paraphrase | The customer's own text | Only claims present in that text |
| Regenerate | Identical inputs, new sample | Same rule as the originating action |
| Restyle | An existing draft + a different style | None — subset of the source draft |
| Condense | An existing draft + a lower target | None — subset only |
| Expand | An existing draft + a higher target | None — expansion adds words, not facts |
| Refine | An existing draft + an instruction | Only the instruction, recorded as a newly asserted fact |

Availability is configuration twice over: a tenant enables a subset of the seven, and each style
declares its own `supportedActions`. A draft only offers an action both permit — the 140-character
`micro` style never offers Expand, and `ironworks` never offers Restyle, Expand or Refine.

## What to look at first

1. **`results-grounding-stripped`** — the removed claim quoted with its reason, and a restore
   affordance that opens an empty field. It never reinserts the text. This is the product.
2. **`paraphrase-input`** — the most grounded path, presented as an equal to Generate rather than a
   secondary feature.
3. **Admin → Actions** — switch off Restyle and watch it leave the survey's action bars.
4. **Admin → Keywords** — add one, reload the survey, and it is on the keyword screen with no other edit.
5. **`bench`** — the raw `claims[]` array with `sourceKeywordId` and `sourceSpan`, the grounding
   verdict, tokens and cost, at zero cost through the fake provider.
6. **`generation-detail`** — one generation reconstructed from its id alone, including the lineage
   chain back to the draft a restyle came from.

## Handoff

The `FIXTURES` block at the top of each surface is a contract proposal: those shapes are intended to
become the Zod schemas in `packages/contracts`, and the field names are load-bearing. The state names
are intended to survive into the implementation as route or machine states.

## Revision R2

Two defects were fixed: the survey had no origin, and multi-tenancy was asserted rather than demonstrated.

**The link is now the entry model.** `/s/<tenantSlug>/<locationSlug>?v=<visitToken>&t=<tableRef>` — the survey resolves tenant, venue and visit from it, the harness shows the link it is simulating, and `entry`, `verification`, `entry-token-used` and `invalid-link` all follow from what the link did or did not carry.

**Configuration has three scopes.** Platform, tenant and location. Every settings field is badged with the scope that owns it, a persistent `Platform › Tenant › Location` bar drives every console screen, and location values inherit the tenant with overrides marked and resettable.

**The second tenant differs structurally.** Speicher Neun is a German-language Hamburg restaurant with two venues, walk-in trade, a QR on the table, no verification, its own keyword taxonomy, five actions and no disclosure requirement. Brightsmile Dental is English, invited, verified, seven actions, disclosure on. Nothing in the markup branches on which is which.

Survey: 20 addressable states. Console: 23 views, gated by three operator roles. `DECISIONS.md` records every ambiguity resolved in this revision, including the German strings authored beyond the brief's fixture list.
