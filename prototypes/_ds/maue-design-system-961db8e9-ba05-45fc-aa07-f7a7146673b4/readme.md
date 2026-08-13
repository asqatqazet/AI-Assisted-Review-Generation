# Maue Design System

**Version:** alpha · **System name:** `maue-design-system`

Maue's web system is a controlled enterprise-AI interface built from stark white editorial space, deep indigo and clay product bands, soft mineral surfaces, rounded media cards, and a distinctive type split between monospaced-feeling display headlines and precise grotesque UI text.

This project turns that written specification into working CSS tokens, React primitives, foundation specimens and a full-page UI kit recreation.

---

## Sources

| Source | What it gave us | Access |
|---|---|---|
| `uploads/Maue Design System.md` | The complete brand specification: color palette, type scale, radius/spacing scales, elevation model, 14 named component definitions, do's and don'ts, responsive behavior, known gaps. | In this project |
| — | No Figma file, GitHub repository, or codebase was provided. | — |
| — | No logo files, photography, illustrations, icon binaries or font binaries were provided. | — |

Everything in this project derives from that single markdown specification. Where the spec is silent, this readme says so explicitly rather than inventing a value (see [Known gaps & substitutions](#known-gaps--substitutions)).

### Products & surfaces represented

The spec describes one product family behind a marketing/editorial web presence:

1. **Marketing website** — home page (hero declaration, media composition, trust logos), product/platform pages, and solution pages for financial services and security. This is the primary surface and the one recreated in `ui_kits/website/`.
2. **Editorial surfaces** — a blog index with hero-scale marigold taxonomy, and a research index with rule-separated publication rows and compact filter pills.
3. **Contact / demo capture** — two-column forms inside a rounded white panel on dark or chalk sections.
4. **Agent console (as product proof, not a product surface)** — dark mockup panels showing agent names, status chips, integration badges, prompt fields and generated response cards. The spec presents these *inside* marketing pages; no real application shell is documented, so none was invented.

---

## Index

**Root**
- `styles.css` — the single entry point consumers link. `@import` lines only.
- `readme.md` — this file.
- `SKILL.md` — Agent Skills front-matter so this folder works as a Claude Code skill.
- `thumbnail.html` — homepage tile for the system.

**`tokens/`** — `fonts.css`, `colors.css`, `typography.css`, `spacing.css`, `radius.css`, `elevation.css`, `motion.css`

**`guidelines/`** — foundation specimen cards (Type, Colors, Spacing, Brand) plus `motion-and-states.md`

**`components/`** — 15 React primitives, grouped by concern:

| Group | Components |
|---|---|
| `actions/` | `ButtonPrimary`, `ButtonSecondary`, `ButtonPillOutline` |
| `site/` | `AnnouncementBar`, `TrustLogoStrip`, `FooterNewsletter` |
| `media/` | `HeroPhotoCard` (+ `HeroPhotoCardOverlayNote`), `AgentConsoleCard`, `Icon` |
| `content/` | `CapabilityCard`, `ProductCard`, `DarkFeatureBand` |
| `editorial/` | `BlogFilterChip`, `ResearchTable` |
| `forms/` | `ContactFormCard` |

Each component directory holds `<Name>.jsx`, `<Name>.d.ts` (props contract), `<Name>.prompt.md` (what & when, usage, variants), and one `@dsCard` HTML specimen.

**`ui_kits/website/`** — click-through recreation of the Maue marketing site: `index.html` (interactive shell), `SiteNav.jsx`, `HomeScreen.jsx`, `PlatformScreen.jsx`, `BlogScreen.jsx`, `ResearchScreen.jsx`, `ContactScreen.jsx`, `README.md`.

**`assets/`** — see `assets/README.md`. **No brand assets were supplied**; the folder documents that absence rather than holding stand-ins.

### Component-to-spec mapping

All 14 components named in the spec are implemented 1:1. Spec name → export:

`button-primary` → `ButtonPrimary` · `button-secondary` → `ButtonSecondary` · `button-pill-outline` → `ButtonPillOutline` · `announcement-bar` → `AnnouncementBar` · `hero-photo-card` → `HeroPhotoCard` · `agent-console-card` → `AgentConsoleCard` · `trust-logo-strip` → `TrustLogoStrip` · `capability-card` → `CapabilityCard` · `dark-feature-band` → `DarkFeatureBand` · `product-card` → `ProductCard` · `blog-filter-chip` → `BlogFilterChip` · `research-table` → `ResearchTable` · `contact-form-card` → `ContactFormCard` · `footer-newsletter` → `FooterNewsletter`

**Intentional additions** (not in the spec, listed here so consumers know they are ours):
- `Icon` — a thin-line Lucide wrapper. The spec prescribes Lucide/Phosphor at a uniform 1.5px stroke but ships no icon binary; every component that takes an icon needs one consistent renderer.
- `HeroPhotoCardOverlayNote` — the small dark status module the spec describes as overlaying hero media, exposed so `HeroPhotoCard.overlay` has a canonical filling.
- `SiteNav` / footer composition inside the UI kit — the spec documents the three-zone nav under *Layout*, not as a component, so it lives in the kit rather than in `components/`.

---

## Content fundamentals

Maue's copy sounds like a research lab writing to a risk committee. Sober, declarative, specific. It never sells with adjectives; it states what the system does and what it will not do.

**Voice.** Third-person and impersonal for claims about the product ("Every agent action is attributable"), second-person only when addressing the reader's own systems ("your systems of record"). Almost never first-person plural — "we" appears in commitments and replies ("We reply within one business day"), not in boasts. No "our revolutionary platform".

**Sentence shape.** Short declaratives. Periods, not exclamation marks. The strongest sentence is usually the shortest one: *"Controls that survive an audit."* Headlines routinely omit verbs entirely and read as nouns: *"Agent infrastructure for regulated work."* Body copy runs one or two sentences per block; a `CapabilityCard` body is a single line.

**Casing.** Sentence case everywhere — headlines, buttons, nav, form labels. The only uppercase in the system is the Space Mono system label (`ORCHESTRATION`, `FINANCIAL SERVICES`, `RESPONSE`), which is a taxonomy marker rather than prose. Never title-case a button; it is "Book a demo", never "Book A Demo".

**Concreteness over abstraction.** Name the system, the standard, the number: "SOC 2 Type II", "Private VPC deploy", "Audit trail export", "3 exceptions flagged". Where a real number does not exist, the system prefers a placeholder frame to a fabricated metric — the `AgentConsoleCard`'s `bars` prop deliberately renders neutral bars instead of invented percentages.

**Verbs the brand uses:** route, ground, attribute, reconcile, audit, log, deploy, review, reverse. **Verbs it avoids:** unleash, supercharge, revolutionize, empower, transform.

**CTA vocabulary.** Primary: "Book a demo", "Talk to sales", "Submit". Secondary: "Explore the platform", "Open the sandbox", "Read the paper", "Read the docs", "Security overview". Secondary CTAs are verbs of *inspection* — the brand invites scrutiny, which is the whole positioning.

**Microcopy.** Twelve-pixel copy sets expectations and reduces risk: "No product marketing. Unsubscribe in one click." / "We reply within one business day." Announcement bars carry exactly one sentence plus "Learn more".

**Editorial copy.** Blog and research titles are long, technical and unafraid of jargon: *"Attributable agent actions in regulated workflows"*, *"Evaluating tool use under partial observability"*. Dates are terse ("Jun 2026"). Author lines read "Maue Research".

**Emoji: never.** Not in UI, not in editorial, not in marketing copy. The taxonomy and status vocabulary is carried by uppercase mono labels, hairline pills and a 6px status dot. Unicode is used sparingly and only functionally: `→` for forward actions, `✓` for checklist rows, `×` for dismiss.

---

## Visual foundations

### Color

White is the system's default, not a background choice. Color arrives in four ways only: **dark product bands** (deep indigo `#191d3f` for platform/workspace, deep clay `#33211a` for financial services and security), **media** (photography, abstract 3D renders, video posters), **editorial taxonomy** (marigold `#b5701c` chips, action blue `#1c54c9` links), and **mineral washes** (warm chalk `#eae7e0`, pale lilac `#f3f0fb`, pale sand `#fbf6ed`) used as quiet section or card fields.

Rules of thumb: one or two dark bands per page, never adjacent. Marigold is editorial taxonomy and the footer eyebrow — never a CTA fill, never body-size text (it sits near the 3:1 large-text floor on white and is only safe at the 32px chip scale). Action blue is for links and pagination, never for buttons. True black `#000000` belongs to the announcement bar and the highest-contrast text; the near-black `#16181d` is the CTA and dark-surface color.

### Type

Space Grotesk for display, Inter for everything in the UI, Space Mono for uppercase technical labels. Weights stop at 500 — hierarchy is size, tracking and surface contrast, never bold. Display sizes are large and carved: 96px hero at line-height 1 and −1.92px tracking; 72px product display at −1.44px. One oversized headline per page, then the page settles into 16–24px. Tracking goes negative as size goes up and positive (+0.28px) only on mono labels.

### Spacing & layout

8px base with honest one-offs (6, 10, 20, 22, 28, 36, 56, 60 are real values in the system — do not snap them to a 4/8 grid). Sections run on 80px vertical rhythm, and the intervals *between* the brand claim, the customer proof, the product proof and the CTA are deliberately larger (~160px). Whitespace is a trust signal: the trust-logo strip sits far below the hero media, and dark panels float in fields of white.

Containers cap at 1280px with a 24px gutter. The nav is three-zone: wordmark left, menu centered, sign-in + CTA right. Home hero is centered text above a two-card media composition — a wide product mockup card beside a narrower photography card. Feature sections are 3-up on desktop, collapsing 3 → 2 → 1. Research pages use full-width rule-separated lists rather than cards. Forms use two-column rows inside a rounded white card.

### Backgrounds

Flat fills only. No repeating patterns, no textures, no noise, no hand-drawn illustration, no decorative background imagery behind text — with one exception: CTA bands may use full-bleed imagery. Gradients are **media-led**: they exist inside abstract 3D hero renders, deep-blue particle fields and warm video posters, never as a UI fill. A gradient behind a button, card or section is off-brand.

### Imagery

Two registers. **Enterprise photography** — cool, desaturated, natural light, real workplaces, no stock-smile energy. **Abstract 3D renders** — warm-to-neutral mineral forms, soft shadow, shallow depth of field, used on blog CTAs and hero cards. Both sit as rounded cards with visible corners (22px on large media, 8px on thumbnails), not as bleeds behind text. No grain overlay, no duotone, no color-wash treatment. Where no image exists, the system shows a tone field with an uppercase mono label — an honest placeholder beats invented product content.

### Corner radii & cards

4px small images, search fields, article thumbnails · 8px chips, cards, small media, dialogs · 16px medium grouped blocks · **22px the signature media-card radius** · 30px filter pills · 32px primary CTA pills · 9999px status dots. Nothing below 8px for major media.

A Maue card is: a flat fill (white, warm chalk, or a dark band color), a 1px hairline *or* no border at all, 8–32px radius, 24–32px padding, and **no shadow**. Many "cards" are not boxes at all — a `CapabilityCard` defaults to a top hairline and open space. Prefer unframed rows and rules over boxing everything.

### Elevation

The system is flat by design. There is no drop-shadow scale, and adding one is a documented don't. Depth comes from surface alternation (white → chalk → indigo), media contrast, rounded corners and 1px rules. Four levels: flat, bordered (1px `#d9d9dd` / `#e5e7eb` / translucent white on dark), media lift (rounded media over a contrasting field), and dark product field (full-width indigo or clay).

### Borders & rules

`#d9d9dd` hairline for list rules and section dividers, `#e5e7eb` for utility rules, `#f2f2f2` for the softest card containment, `rgba(255,255,255,.16)` on dark bands. Always 1px. Rules do more structural work here than borders do — a research row is a rule, not a card.

### Transparency & blur

Used only on dark bands, and only at two strengths: `rgba(255,255,255,.06)` for a nested surface and `rgba(255,255,255,.16)` for its border. Light surfaces are opaque. **No backdrop blur, no frosted glass anywhere** — nothing in the spec calls for it, and it would contradict the flat model. There are no protection gradients or scrims: text is never placed over imagery that needs one; it sits in a solid capsule (`HeroPhotoCardOverlayNote`, `AgentConsoleCard`) instead.

### Motion, hover, press, focus

The spec explicitly lists motion, transition timing and easing as undocumented. `tokens/motion.css` therefore carries flagged defaults rather than brand values: 120/180/320ms with `cubic-bezier(.2,0,.2,1)`, and transitions only on color, background, border and opacity — never on transform or size. Conventions implemented across the components (also flagged, see `guidelines/motion-and-states.md`):

- **Hover** — primary pill darkens near-black → true black; white pill on dark drops to 88% opacity; text links drop to 70% opacity; outline pills pick up a pale lilac fill; research rows tint pale lilac and underline the title.
- **Press** — 82% opacity. No scale, no translate; the system does not bounce or squish.
- **Focus** — 2px `#4c6ee6` ring at 2px offset. Text inputs are the exception: the border turns violet `#9b60aa`, which appears nowhere else.
- **Disabled** — 40% opacity, `not-allowed` cursor.
- No entrance animations, no parallax, no scroll-triggered reveals, no marquees. Layout is static; nothing is fixed except the nav, which is sticky at 72px under a 36px announcement bar.

---

## Iconography

**What the brand specifies.** A thin-line geometric icon set at a uniform 1.5px stroke, used for capability cards, research markers and small UI affordances. Icons are monochrome and inherit text color — near-black on light, white on dark. There is no icon font, no sprite sheet and no colored or filled icon style. The spec also calls for "thin-line geometric illustrations" for research and capability blocks: line drawings at the same stroke weight, not filled art.

**What we ship.** No icon binaries were provided, so the system uses **[Lucide](https://lucide.dev) 0.454.0 (ISC) from CDN** — the open baseline the spec itself names — wrapped in `Icon`. This is a flagged substitution, not a brand asset. Load it once per page:

```html
<script src="https://unpkg.com/lucide@0.454.0/dist/umd/lucide.min.js"></script>
```

```jsx
<Icon name="shield-check" size={26} />        // decorative, inherits currentColor
<Icon name="search" size={16} label="Search" /> // with an accessible name
```

Sizes in use: 16px inline, 20–22px in controls and rows, 26–28px above a capability heading. Never above 1.5px stroke — the uniform hairline stroke is the signature. Phosphor (MIT) at its "light" weight is an acceptable alternative if a consumer prefers it; do not mix the two sets in one surface.

**Unicode and emoji.** Emoji are never used. Three unicode glyphs are used functionally and deliberately: `→` (forward actions, newsletter submit, "explore" links), `✓` (product-card checklist rows), `×` (announcement dismiss). Status is a 6px round dot, not a glyph.

**Illustration.** None shipped. The spec's thin-line geometric illustrations require real vector assets; drawing approximations would misrepresent the brand, so capability blocks currently use Lucide glyphs at 26px and media frames use labelled placeholder fields. **This is the largest open item** — see below.

---

## Known gaps & substitutions

Flagged honestly so nobody mistakes our defaults for Maue's decisions.

1. **No logo or wordmark files.** Nothing in the sources contains a Maue mark, so none was drawn. Every place a logo belongs renders the word **Maue** in Space Grotesk 400 with −0.5px tracking. Send us the SVG and we will swap it in wherever `assets/logo.svg` is referenced.
2. **No font binaries.** Space Grotesk, Inter and Space Mono are all SIL OFL, so `tokens/fonts.css` loads them from the Google Fonts CDN. If you want self-hosted woff2 (recommended for enterprise deploys), drop the files into `assets/fonts/` and replace the single `@import` with `@font-face` rules. **Please confirm these are the licensed families** — they came from the spec's own naming, not from a foundry contract.
3. **No icon assets.** Substituted Lucide from CDN (see Iconography). No thin-line illustration set exists yet.
4. **No photography, 3D renders or customer logos.** All media renders as tone fields with uppercase mono labels; trust-strip customers render as plain wordmarks. Customer names used in specimens (Northwind, Aster Bank, Verdant, Lumen Health) are obvious placeholders, not claims.
5. **Motion is undocumented in the source.** All timing, easing, hover, press and focus behaviour in `tokens/motion.css` and the components is our conservative inference. Treat it as a proposal.
6. **Dark-band variants of forms, tables and capability cards** are described qualitatively in the spec with no separate token set. Implemented via `onSurface="dark"` props using translucent white surfaces/rules; the values are ours.
7. **Empty, loading and error states** are documented only through the `error` color. No skeleton or empty-state patterns are defined; media placeholders stand in.
8. **Mobile** behaviour is derived from the spec's responsive table, itself written from the desktop system. No dedicated mobile specs exist.
9. **No application shell.** The agent console appears only as marketing product proof, so no signed-in product UI kit was built — inventing one would contradict "avoid invented dashboard data".

---

## Using this system

```html
<link rel="stylesheet" href="styles.css">
<script src="https://unpkg.com/lucide@0.454.0/dist/umd/lucide.min.js"></script>
```

Then reference tokens rather than raw hex: `var(--surface-band-indigo)`, `var(--type-hero)`, `var(--radius-lg)`. Base tokens carry the spec's own names (`--deep-indigo`, `--marigold`, `--warm-chalk`); semantic aliases (`--text-body`, `--surface-card`, `--action-primary-bg`, `--border-rule`) are what product code should use.

Composition order for a marketing page: `AnnouncementBar` → nav → hero (`HeroPhotoCard` + `AgentConsoleCard` overlay) → `TrustLogoStrip` → `CapabilityCard` row → `DarkFeatureBand` → `ProductCard` row → `ContactFormCard` → `FooterNewsletter`.
