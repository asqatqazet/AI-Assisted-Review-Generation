# Onboarding an account

How an operator takes a business from nothing to a reviewer writing a draft,
and what each field decides. Written against the Console as built; where
something is not yet possible, this says so rather than implying it.

Canonical language: an **account** is a Tenant, a **venue** is a Location, a
**fact option** is a Fact Option, and a **review format** is a Review Format.

## The short path

```text
Platform → Accounts        provision the account
      ↓
Account settings           language, entry, policy, budget
      ↓
Locations                  add each venue and its address
      ↓
Business context           what the model may treat as true
      ↓
Fact options               what a reviewer can assert
      ↓
Review formats / Actions   what may be produced
      ↓
Distribution → Publish     materialise the venue's configuration
      ↓
Distribution → link / QR   hand out
```

Nothing reaches a reviewer until **Publish** runs. The survey is served from a
published snapshot, never from the tables you just edited.

## 1. Provision the account

**Platform → Accounts → Provision an account.** Requires a platform grant.

| Field | What it decides |
|---|---|
| Name | Shown to reviewers as the business they are reviewing. |
| Slug | The account segment of every survey URL: `/s/<slug>/<venue>`. Lower case, digits and hyphens. Unique across the platform, and awkward to change later because printed links embed it. |
| Locale | The language reviewers see, and the only review formats the account may enable. `en-GB` or `de-DE`. |
| Category | Free text, for finding the account in the Accounts table. Carries no behaviour. |
| Plan | Free text label for commercial tracking. Carries no behaviour. |

Provisioning is a data record, not a deployment. The new account starts from
the platform catalogue: entry actions enabled, the newest review format for its
locale, one fact option category, the platform policy template, and entry mode
`open-qr`.

## 2. Account settings

**Account settings.** Everything here is owned by the account; a venue may
override only the fields marked overridable on its own settings page.

### Identity and language

| Field | What it decides |
|---|---|
| Locale | Language of the reviewer experience, and which review formats can be enabled. |
| Tone guidelines | Register guidance for the model. It **cannot introduce facts** — only a reviewer's confirmed assertions can. |

### Reviewer entry

| Field | What it decides |
|---|---|
| Entry mode | `open-qr` admits anyone who scans, and proves no visit. `invite` requires a token. `both` accepts either. Overridable per venue. |
| Require verified experience | Admit only reviewers whose visit could be verified. Turning it off widens who may write. Overridable per venue. |

> The Console cannot issue invitation tokens yet. An account set to `invite`
> has no way to admit a reviewer from here, which is why provisioning defaults
> to `open-qr`. Choose `invite` only if tokens are issued by other means.

### Drafting policy

| Field | What it decides |
|---|---|
| Review disclosure | Tell the reviewer their draft was assisted, before they copy it. Overridable per venue. |
| Review formats per request | How many drafts one request may produce. **Each is a paid call.** Overridable per venue. |
| Banned terms | Words a draft may never contain. A draft containing one is rejected, not edited. Overridable per venue. |

### Budget

| Field | What it decides |
|---|---|
| Monthly budget | Spending ceiling for assisted drafting, entered in currency. |
| Budget alert threshold | The share of budget that raises the warning banner on the overview. |

### Fact option categories

How fact options are grouped for a reviewer. Add one here; it needs no release.
An account with no category cannot group fact options.

## 3. Add venues

**Locations → Add a Location.**

| Field | What it decides |
|---|---|
| Name | Shown to the reviewer as the venue being reviewed. |
| Slug | The venue segment of the survey URL. Unique within the account. Printed links embed it, so treat it as permanent. |
| Address | Operator reference. Not shown to reviewers. |
| Active | An inactive venue refuses entry, and its QR is withheld rather than printed to a dead end. |

Per-venue overrides live on **Locations → Settings**. A field either inherits
from the account or holds its own value; **Reset** deletes the override so the
venue follows the account again, rather than freezing today's value.

## 4. Configure what may be said

| Screen | Purpose |
|---|---|
| Business context | Facts about the business the model may rely on, plus banned terms. Saving publishes a new immutable version; existing generations keep resolving the version they were grounded on. |
| Fact options | What a reviewer can assert. Each carries a category, polarity and owner scope — account-wide, or added by one venue. |
| Review formats | Which platform formats this account offers. A format whose locale does not match the account is listed but refused, with the reason shown. |
| Drafting actions | Which actions reviewers may use. The last enabled entry action cannot be disabled, or the survey would have no way to start. |

## 5. External destinations

**Locations → Distribution → Review destinations.** Where a reviewer is sent
after drafting.

| Field | What it decides |
|---|---|
| Place identifier | The venue's id on that platform. Belongs to the venue, so two venues of one account point at different listings. |
| Review link | The `https://` page the reviewer opens. Validated on save. |
| Enabled | Only enabled destinations are offered to reviewers. |

An enabled destination must carry both an identifier and an `https://` link.

## 6. Publish, then hand out

**Locations → Distribution → Publish configuration to this venue.**

This materialises the venue's Effective Configuration Snapshot from current
account settings, fact options, enabled review formats, prompt versions and
platform provider routing. **Generation reads that snapshot, not the live
tables.** Publish after any change that should reach reviewers, including a
change to platform provider routing.

If it refuses, it names what is missing — commonly an enabled review format, a
prompt version, or a routed model with a published price.

Then take the assets:

- **Distribution** (account-wide) lists every venue with its link, QR, entry
  mode and counters.
- **Locations → Distribution** (one venue) adds invitation and table copy.

The QR encodes the venue's own survey URL and carries no token, so it is
offered only where a scan can actually admit someone: `open-qr` or `both`, and
only while the venue is active.

## Checklist

1. Account provisioned with slug and locale.
2. Entry mode decided, and verified experience set deliberately.
3. Monthly budget above zero.
4. At least one venue, active, with a slug you can live with.
5. Business context published.
6. Fact options covering what reviewers actually want to say.
7. At least one review format enabled, compatible with the locale.
8. At least one entry action enabled.
9. A review destination with an identifier and an `https://` link.
10. **Publish configuration** on each venue.
11. Scan the QR yourself before printing it.

## Not yet available

- **Invitation tokens** cannot be issued from the Console, so `invite` mode
  has no operator-driven path in.
- **Overview, analytics, generation detail and bench** report that the
  deployment cannot build them; they need the execution-plane reader.
- **Accounts cannot be deleted.** Suspend stops reviewer entry and is
  reversible; deactivate is permanent. Both retain history, because venues and
  generations reference the account.
