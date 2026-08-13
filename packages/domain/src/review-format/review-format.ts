import type { CommandKind, Locale } from "../configuration/index.js";

export type ReviewFormatLocale = Locale | "any";

export interface ReviewFormatConstraints {
  readonly minChars: number;
  readonly maxChars: number;
  readonly paragraphs: number;
  readonly emojiPolicy: "none" | "allowed";
  readonly secondPerson: boolean;
}

export interface FewShotExample {
  readonly input: string;
  readonly output: string;
  readonly claims?: readonly string[];
}

export interface PromptFragments {
  readonly styleGuide: string;
  readonly fewShot: readonly FewShotExample[];
}

export interface ReviewFormatManifest {
  readonly key: string;
  readonly version: string;
  readonly displayName: string;
  readonly targetPlatform: string;
  readonly locale: ReviewFormatLocale;
  readonly description: Readonly<Partial<Record<Locale, string>>>;
  readonly sample: Readonly<Partial<Record<Locale, string>>>;
  readonly constraints: ReviewFormatConstraints;
  readonly supportedCommands: readonly CommandKind[];
  readonly promptFragments: PromptFragments;
  readonly postProcess?: (text: string) => string;
}

export class ReviewFormatManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewFormatManifestError";
  }
}

export class FormatContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormatContractError";
  }
}

export function validateFormatManifest(
  manifest: ReviewFormatManifest,
): ReviewFormatManifest {
  if (!manifest.key || manifest.key.trim().length === 0) {
    throw new ReviewFormatManifestError("key cannot be empty.");
  }
  if (!manifest.version || manifest.version.trim().length === 0) {
    throw new ReviewFormatManifestError("version cannot be empty.");
  }
  if (!manifest.displayName || manifest.displayName.trim().length === 0) {
    throw new ReviewFormatManifestError("displayName cannot be empty.");
  }
  if (!manifest.targetPlatform || manifest.targetPlatform.trim().length === 0) {
    throw new ReviewFormatManifestError("targetPlatform cannot be empty.");
  }

  const { constraints } = manifest;
  if (!constraints) {
    throw new ReviewFormatManifestError("constraints must be defined.");
  }
  if (constraints.minChars < 0) {
    throw new ReviewFormatManifestError(
      "constraints.minChars must be non-negative.",
    );
  }
  if (constraints.maxChars <= 0) {
    throw new ReviewFormatManifestError(
      "constraints.maxChars must be positive.",
    );
  }
  if (constraints.minChars > constraints.maxChars) {
    throw new ReviewFormatManifestError(
      "constraints.minChars must not exceed constraints.maxChars.",
    );
  }
  if (constraints.paragraphs < 1) {
    throw new ReviewFormatManifestError(
      "constraints.paragraphs must be at least 1.",
    );
  }
  if (
    constraints.emojiPolicy !== "none" &&
    constraints.emojiPolicy !== "allowed"
  ) {
    throw new ReviewFormatManifestError(
      "constraints.emojiPolicy must be 'none' or 'allowed'.",
    );
  }

  if (
    !Array.isArray(manifest.supportedCommands) ||
    manifest.supportedCommands.length === 0
  ) {
    throw new ReviewFormatManifestError(
      "supportedCommands must contain at least one command.",
    );
  }

  return manifest;
}

export function validateFormatManifestCatalogue(
  catalogue: readonly ReviewFormatManifest[],
): readonly ReviewFormatManifest[] {
  const seenKeys = new Set<string>();
  for (const manifest of catalogue) {
    validateFormatManifest(manifest);
    if (seenKeys.has(manifest.key)) {
      throw new ReviewFormatManifestError(
        `Duplicate format key: ${manifest.key}`,
      );
    }
    seenKeys.add(manifest.key);
  }
  return catalogue;
}

export interface FormatEnablementCheck {
  readonly allowed: boolean;
  readonly reason?: string;
}

export function canEnableFormatForTenant(
  format: ReviewFormatManifest,
  tenantLocale: Locale,
): FormatEnablementCheck {
  if (format.locale === "any" || format.locale === tenantLocale) {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: `Format locale '${format.locale}' is incompatible with tenant locale '${tenantLocale}'.`,
  };
}

export const BUILT_IN_FORMATS: readonly ReviewFormatManifest[] = [
  {
    key: "concise-blurb",
    version: "1.0.0",
    displayName: "Concise blurb",
    targetPlatform: "google",
    locale: "any",
    description: {
      "en-GB": "Short, factual one-paragraph review.",
      "de-DE": "Kurze, sachliche Ein-Absatz-Bewertung.",
    },
    sample: {
      "en-GB": "The staff were attentive and professional.",
      "de-DE": "Das Personal war aufmerksam und professionell.",
    },
    constraints: {
      minChars: 40,
      maxChars: 420,
      paragraphs: 1,
      emojiPolicy: "none",
      secondPerson: false,
    },
    supportedCommands: ["generate", "paraphrase", "reformat"],
    promptFragments: {
      styleGuide:
        "Draft a single concise paragraph. Focus strictly on asserted factual propositions.",
      fewShot: [
        {
          input: "service was good, doctor friendly",
          output: "The doctor was friendly and the service was efficient.",
          claims: ["doctor was friendly", "service was efficient"],
        },
      ],
    },
  },
  {
    key: "detailed-narrative",
    version: "1.0.0",
    displayName: "Detailed narrative",
    targetPlatform: "tripadvisor",
    locale: "any",
    description: {
      "en-GB": "Structured, thorough multi-paragraph review.",
      "de-DE": "Strukturierte, ausführliche Mehr-Absatz-Bewertung.",
    },
    sample: {
      "en-GB":
        "I visited for an annual check-up.\n\nThe team was punctual and made me feel comfortable.\n\nI recommend this clinic.",
      "de-DE":
        "Ich war zur jährlichen Kontrolle da.\n\nDas Team war pünktlich und professionell.\n\nIch empfehle die Praxis gerne weiter.",
    },
    constraints: {
      minChars: 200,
      maxChars: 1500,
      paragraphs: 3,
      emojiPolicy: "none",
      secondPerson: false,
    },
    supportedCommands: [
      "generate",
      "expand",
      "condense",
      "reformat",
      "paraphrase",
    ],
    promptFragments: {
      styleGuide:
        "Structure across three distinct paragraphs: visit context, direct experience, and conclusion. Ground every fact.",
      fewShot: [
        {
          input: "went for checkup, gentle hygienist, on-time",
          output:
            "I booked a routine check-up appointment.\n\nThe hygienist was gentle and the entire team ran precisely on schedule.\n\nThe overall experience was seamless.",
          claims: [
            "routine check-up appointment",
            "hygienist was gentle",
            "team on schedule",
          ],
        },
      ],
    },
  },
  {
    key: "social-short",
    version: "1.0.0",
    displayName: "Social short",
    targetPlatform: "instagram",
    locale: "any",
    description: {
      "en-GB": "Bite-sized social post with emojis.",
      "de-DE": "Kurzer Social-Media-Beitrag mit Emojis.",
    },
    sample: {
      "en-GB": "Loved the quick service today! Highly recommend.",
      "de-DE": "Toller und schneller Service heute! Sehr empfehlenswert.",
    },
    constraints: {
      minChars: 20,
      maxChars: 140,
      paragraphs: 1,
      emojiPolicy: "allowed",
      secondPerson: true,
    },
    // Note: 140-char limit means expand is not supported
    supportedCommands: ["generate", "condense", "reformat", "paraphrase"],
    promptFragments: {
      styleGuide:
        "Draft a punchy blurb under 140 characters. Emojis permitted. Never use expand.",
      fewShot: [
        {
          input: "quick clean, friendly team",
          output: "Quick clean and super friendly team today! ✨",
          claims: ["quick clean", "friendly team"],
        },
      ],
    },
  },
];

export function getBuiltInFormat(key: string): ReviewFormatManifest {
  const found = BUILT_IN_FORMATS.find((f) => f.key === key);
  if (!found) {
    throw new ReviewFormatManifestError(`Unknown built-in format key: ${key}`);
  }
  return found;
}

export interface ContractTestResult {
  readonly valid: boolean;
  readonly violations: readonly string[];
}

export function runFormatContractTests(
  manifest: ReviewFormatManifest,
): ContractTestResult {
  try {
    validateFormatManifest(manifest);
  } catch (error) {
    throw new FormatContractError(
      error instanceof Error ? error.message : String(error),
    );
  }

  // Verify postProcess purity: postProcess runs BEFORE grounding guard,
  // so anything it introduces must not inflate text or inject ungrounded text.
  if (manifest.postProcess) {
    const sample = "The service was quick.";
    const processed = manifest.postProcess(sample);
    if (processed.length > sample.length) {
      throw new FormatContractError(
        "postProcess must not add new text or ungrounded claims.",
      );
    }
  }

  return { valid: true, violations: [] };
}

export interface DroppedClaimsResult {
  readonly text: string;
  readonly retainedClaims: readonly string[];
  readonly droppedClaims: readonly string[];
}

export function enforceMaxCharsByDroppingWholeClaims(
  text: string,
  claims: readonly { id: string; text: string }[],
  maxChars: number,
): DroppedClaimsResult {
  if (text.length <= maxChars) {
    return {
      text,
      retainedClaims: claims.map((c) => c.id),
      droppedClaims: [],
    };
  }

  const retained: { id: string; text: string }[] = [];
  const dropped: string[] = [];

  let currentText = "";
  for (const claim of claims) {
    const candidateText =
      currentText.length === 0 ? claim.text : `${currentText} ${claim.text}`;
    if (candidateText.length <= maxChars) {
      retained.push(claim);
      currentText = candidateText;
    } else {
      dropped.push(claim.id);
    }
  }

  return {
    text: currentText,
    retainedClaims: retained.map((c) => c.id),
    droppedClaims: dropped,
  };
}
