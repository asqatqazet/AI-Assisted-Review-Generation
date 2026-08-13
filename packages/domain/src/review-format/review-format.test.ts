import { describe, expect, it } from "vitest";

import {
  BUILT_IN_FORMATS,
  FormatContractError,
  ReviewFormatManifestError,
  canEnableFormatForTenant,
  enforceMaxCharsByDroppingWholeClaims,
  getBuiltInFormat,
  runFormatContractTests,
  validateFormatManifest,
  validateFormatManifestCatalogue,
  type ReviewFormatManifest,
} from "./index.js";

const sampleValidManifest: ReviewFormatManifest = {
  key: "concise-blurb",
  version: "1.0.0",
  displayName: "Concise blurb",
  targetPlatform: "google",
  locale: "any",
  description: {
    "en-GB": "Short and concise review blurb.",
    "de-DE": "Kurze und prägnante Zusammenfassung.",
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
    styleGuide: "Keep it under one paragraph and focus on facts.",
    fewShot: [
      {
        input: "service was good, doctor friendly",
        output: "The doctor was friendly and the service was efficient.",
        claims: ["doctor was friendly", "service was efficient"],
      },
    ],
  },
};

describe("TS-14 Review Format Manifest System", () => {
  describe("validateFormatManifest", () => {
    it("accepts a valid manifest", () => {
      const validated = validateFormatManifest(sampleValidManifest);
      expect(validated.key).toBe("concise-blurb");
      expect(validated.version).toBe("1.0.0");
    });

    it("rejects invalid constraints where minChars > maxChars naming the first offending field", () => {
      const invalid = {
        ...sampleValidManifest,
        constraints: {
          ...sampleValidManifest.constraints,
          minChars: 500,
          maxChars: 100,
        },
      };

      expect(() => validateFormatManifest(invalid)).toThrow(
        ReviewFormatManifestError,
      );
      expect(() => validateFormatManifest(invalid)).toThrowError(
        /constraints.minChars.*exceed.*maxChars/i,
      );
    });

    it("rejects manifest with empty key naming field", () => {
      const invalid = { ...sampleValidManifest, key: "" };
      expect(() => validateFormatManifest(invalid)).toThrow(
        ReviewFormatManifestError,
      );
      expect(() => validateFormatManifest(invalid)).toThrowError(
        /key.*cannot be empty/i,
      );
    });

    it("rejects manifest with empty supportedCommands list", () => {
      const invalid = { ...sampleValidManifest, supportedCommands: [] };
      expect(() => validateFormatManifest(invalid)).toThrow(
        ReviewFormatManifestError,
      );
      expect(() => validateFormatManifest(invalid)).toThrowError(
        /supportedCommands.*at least one command/i,
      );
    });
  });

  describe("validateFormatManifestCatalogue", () => {
    it("rejects catalogue with duplicate keys", () => {
      const catalogue = [
        sampleValidManifest,
        { ...sampleValidManifest, displayName: "Duplicate Key Format" },
      ];

      expect(() => validateFormatManifestCatalogue(catalogue)).toThrow(
        ReviewFormatManifestError,
      );
      expect(() => validateFormatManifestCatalogue(catalogue)).toThrowError(
        /duplicate.*key: concise-blurb/i,
      );
    });
  });

  describe("canEnableFormatForTenant", () => {
    it("allows enablement when manifest locale is 'any'", () => {
      const check = canEnableFormatForTenant(sampleValidManifest, "en-GB");
      expect(check.allowed).toBe(true);
      expect(check.reason).toBeUndefined();
    });

    it("allows enablement when manifest locale exactly matches tenant locale", () => {
      const germanOnly = { ...sampleValidManifest, locale: "de-DE" as const };
      const check = canEnableFormatForTenant(germanOnly, "de-DE");
      expect(check.allowed).toBe(true);
    });

    it("rejects enablement and returns actionable reason when locale does not match", () => {
      const germanOnly = { ...sampleValidManifest, locale: "de-DE" as const };
      const check = canEnableFormatForTenant(germanOnly, "en-GB");
      expect(check.allowed).toBe(false);
      expect(check.reason).toBe(
        "Format locale 'de-DE' is incompatible with tenant locale 'en-GB'.",
      );
    });
  });

  describe("Built-in review formats", () => {
    it("ships concise-blurb, detailed-narrative, and social-short", () => {
      expect(BUILT_IN_FORMATS).toHaveLength(3);
      const keys = BUILT_IN_FORMATS.map((f) => f.key);
      expect(keys).toContain("concise-blurb");
      expect(keys).toContain("detailed-narrative");
      expect(keys).toContain("social-short");
    });

    it("enforces that 140-char social-short does NOT support expand", () => {
      const social = getBuiltInFormat("social-short");
      expect(social.constraints.maxChars).toBeLessThanOrEqual(140);
      expect(social.supportedCommands).not.toContain("expand");
      expect(social.supportedCommands).toContain("condense");
    });

    it("provides detailed-narrative with multi-paragraph constraints and expand support", () => {
      const detailed = getBuiltInFormat("detailed-narrative");
      expect(detailed.constraints.paragraphs).toBe(3);
      expect(detailed.constraints.maxChars).toBeGreaterThanOrEqual(1000);
      expect(detailed.supportedCommands).toContain("expand");
    });
  });

  describe("Contract test kit", () => {
    it("all three built-ins pass the contract test kit", () => {
      for (const format of BUILT_IN_FORMATS) {
        const result = runFormatContractTests(format);
        expect(result.valid).toBe(true);
        expect(result.violations).toHaveLength(0);
      }
    });

    it("broken manifest fails contract test kit", () => {
      const broken: ReviewFormatManifest = {
        ...sampleValidManifest,
        key: "broken-format",
        constraints: {
          ...sampleValidManifest.constraints,
          minChars: 300,
          maxChars: 50,
        },
      };

      expect(() => runFormatContractTests(broken)).toThrow(
        FormatContractError,
      );
    });

    it("postProcess runs purely and cannot introduce new ungrounded text", () => {
      const formatWithCleanPostProcess: ReviewFormatManifest = {
        ...sampleValidManifest,
        postProcess: (text: string) => text.trim(),
      };

      const result = runFormatContractTests(formatWithCleanPostProcess);
      expect(result.valid).toBe(true);
    });

    it("fails contract when postProcess inflates text length inappropriately", () => {
      const maliciousPostProcess: ReviewFormatManifest = {
        ...sampleValidManifest,
        postProcess: (text: string) => `${text} unverified extra claims added.`,
      };

      expect(() => runFormatContractTests(maliciousPostProcess)).toThrow(
        FormatContractError,
      );
    });
  });

  describe("enforceMaxCharsByDroppingWholeClaims", () => {
    it("drops whole claims rather than truncating text mid-sentence", () => {
      const text =
        "The cleaning was thorough. The receptionist was helpful and warm.";
      const claims = [
        {
          id: "claim-1",
          text: "The cleaning was thorough.",
        },
        {
          id: "claim-2",
          text: "The receptionist was helpful and warm.",
        },
      ];

      // Max chars allows only the first claim (26 chars)
      const adjusted = enforceMaxCharsByDroppingWholeClaims(text, claims, 35);
      expect(adjusted.text).toBe("The cleaning was thorough.");
      expect(adjusted.retainedClaims).toEqual(["claim-1"]);
      expect(adjusted.droppedClaims).toEqual(["claim-2"]);
    });
  });
});
