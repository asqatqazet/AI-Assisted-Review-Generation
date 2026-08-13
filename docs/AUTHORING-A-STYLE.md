# Authoring a Review Format Manifest

This tutorial guides you through creating and validating a new Review Format manifest in under 10 minutes.

Review formats are structured data manifests stored in the platform catalogue. Adding or adjusting a format requires **zero code deployments**.

---

## 1. Review Format Anatomy

A review format manifest conforms to the `StyleManifest` schema:

```json
{
  "key": "executive-brief",
  "version": "1.0.0",
  "displayName": "Executive brief",
  "targetPlatform": "linkedin",
  "locale": "any",
  "description": {
    "en-GB": "High-level professional summary for corporate leadership.",
    "de-DE": "Professionelle Zusammenfassung für Führungskräfte."
  },
  "sample": {
    "en-GB": "The consultation provided actionable strategic clarity.",
    "de-DE": "Die Beratung lieferte umsetzbare strategische Klarheit."
  },
  "constraints": {
    "minChars": 50,
    "maxChars": 300,
    "paragraphs": 1,
    "emojiPolicy": "none",
    "secondPerson": false
  },
  "supportedCommands": ["generate", "condense", "reformat", "paraphrase"],
  "promptFragments": {
    "styleGuide": "Maintain an executive, professional tone. Focus strictly on grounded factual propositions.",
    "fewShot": [
      {
        "input": "strategic audit, prompt delivery, clear next steps",
        "output": "The team conducted a thorough audit with prompt delivery and clear next steps.",
        "claims": ["thorough audit", "prompt delivery", "clear next steps"]
      }
    ]
  }
}
```

---

## 2. Rules and Constraints

1. **Character Limits & Claim Integrity:**
   - `minChars` must be non-negative and `<= maxChars`.
   - Length limits are enforced by dropping whole unasserted claims, never by truncating sentences mid-fact.
2. **Capability Gates via `supportedCommands`:**
   - Tight formats (e.g. `<= 140` characters) must omit `expand`.
   - Capabilities are declared in the manifest, not hardcoded in runtime branches.
3. **Locale Compatibility:**
   - Formats can specify a single locale (e.g. `"de-DE"`) or `"any"`.
   - A tenant can only enable formats compatible with its configured locale.
4. **Post-processing Safety:**
   - If a custom `postProcess` function is used, it executes **before** the Grounding Guard.
   - Post-processors cannot introduce new text or ungrounded claims.

---

## 3. Running Contract Tests

Use the exported test kit from `@review/domain/review-format`:

```ts
import { runFormatContractTests } from "@review/domain/review-format";

const result = runFormatContractTests(myManifest);
if (!result.valid) {
  console.error("Manifest failed contract tests:", result.violations);
}
```

---

## 4. Live Enablement

To enable your format for a tenant, add the format key to the Tenant's `enabledReviewFormatVersionIds` configuration. The effective configuration resolver and snapshot builder will immediately make it available to the generation pipeline.
