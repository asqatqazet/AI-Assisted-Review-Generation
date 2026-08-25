import { describe, expect, it } from "vitest";

import {
  ContradictoryPolicyError,
  applyPolicy,
  availableActions,
  canRequestDraft,
  generateDisclosureNotice,
  requiresVerification,
  type PolicyInput,
} from "./index.js";

const defaultPolicy: PolicyInput = {
  requireDisclosure: false,
  requireVerifiedExperience: false,
  maxReviewFormatsPerRequest: 2,
  bannedTerms: ["guaranteed", "100% free"],
};

describe("TS-10 Policy Engine", () => {
  describe("generateDisclosureNotice", () => {
    it("generates English disclosure for en-GB locale", () => {
      const notice = generateDisclosureNotice("Central Dental", "en-GB");
      expect(notice).toBe(
        "Review generated with AI assistance on behalf of Central Dental.",
      );
    });

    it("generates German disclosure for de-DE locale", () => {
      const notice = generateDisclosureNotice("Zahnärzte Hafenstraße", "de-DE");
      expect(notice).toBe(
        "Bewertung mit KI-Unterstützung im Auftrag von Zahnärzte Hafenstraße erstellt.",
      );
    });

    it("falls back to default en-GB when unsupported locale is passed", () => {
      const notice = generateDisclosureNotice(
        "Tenant X",
        "fr-FR" as unknown as "en-GB",
      );
      expect(notice).toBe(
        "Review generated with AI assistance on behalf of Tenant X.",
      );
    });
  });

  describe("applyPolicy", () => {
    it("does not modify draft or append disclosure when requireDisclosure is false", () => {
      const result = applyPolicy({
        draft: "The service was friendly and efficient.",
        claims: [{ id: "c1", text: "The service was friendly." }],
        policy: defaultPolicy,
        tenantName: "Central Dental",
        locale: "en-GB",
      });

      expect(result.draft).toBe("The service was friendly and efficient.");
      expect(result.appended).toBeUndefined();
      expect(result.violations).toHaveLength(0);
    });

    it("appends disclosure text and includes it in the returned draft when requireDisclosure is true", () => {
      const result = applyPolicy({
        draft: "Great cleaning visit.",
        claims: [{ id: "c1", text: "Great cleaning visit." }],
        policy: { ...defaultPolicy, requireDisclosure: true },
        tenantName: "Central Dental",
        locale: "en-GB",
        disclosurePolicyVersionId: "tenant-policy-r7",
      });

      const expectedDisclosure =
        "Review generated with AI assistance on behalf of Central Dental.";
      expect(result.appended).toBe(expectedDisclosure);
      expect(result.draft).toBe(
        `Great cleaning visit.\n\n${expectedDisclosure}`,
      );
      expect(result.systemAnnotations).toEqual([
        {
          kind: "assisted-review-disclosure",
          text: expectedDisclosure,
          policyVersionId: "tenant-policy-r7",
        },
      ]);
      expect(result.violations).toHaveLength(0);
    });

    it("flags banned terms as policy violations", () => {
      const result = applyPolicy({
        draft: "This treatment is guaranteed to work and 100% free of charge.",
        claims: [{ id: "c1", text: "Treatment works." }],
        policy: defaultPolicy,
        tenantName: "Central Dental",
        locale: "en-GB",
      });

      expect(result.violations).toEqual([
        {
          term: "guaranteed",
          message: 'Draft contains banned term: "guaranteed"',
        },
        {
          term: "100% free",
          message: 'Draft contains banned term: "100% free"',
        },
      ]);
    });

    it("detects case-insensitive banned terms", () => {
      const result = applyPolicy({
        draft: "GUARANTEED satisfaction always.",
        claims: [{ id: "c1", text: "Satisfaction always." }],
        policy: defaultPolicy,
        tenantName: "Central Dental",
        locale: "en-GB",
      });

      expect(result.violations).toEqual([
        {
          term: "guaranteed",
          message: 'Draft contains banned term: "guaranteed"',
        },
      ]);
    });
  });

  describe("canRequestDraft", () => {
    it("allows draft request within maxReviewFormatsPerRequest", () => {
      const check = canRequestDraft({
        policy: { ...defaultPolicy, maxReviewFormatsPerRequest: 2 },
        draftsThisSession: 1,
      });

      expect(check.allowed).toBe(true);
      expect(check.reason).toBeUndefined();
    });

    it("rejects draft request exceeding maxReviewFormatsPerRequest", () => {
      const check = canRequestDraft({
        policy: { ...defaultPolicy, maxReviewFormatsPerRequest: 2 },
        draftsThisSession: 2,
      });

      expect(check.allowed).toBe(false);
      expect(check.reason).toBe(
        "Maximum review formats per request (2) reached for this session.",
      );
    });
  });

  describe("requiresVerification", () => {
    it("rejects contradictory configuration: open-qr with requireVerifiedExperience", () => {
      expect(() =>
        requiresVerification({
          policy: { ...defaultPolicy, requireVerifiedExperience: true },
          entryMode: "open-qr",
          tokenPresent: false,
        }),
      ).toThrow(ContradictoryPolicyError);

      expect(() =>
        requiresVerification({
          policy: { ...defaultPolicy, requireVerifiedExperience: true },
          entryMode: "open-qr",
          tokenPresent: false,
        }),
      ).toThrowError(/open-qr.*cannot require verified experience/i);
    });

    it("returns true when policy requires verification and entry mode is invite", () => {
      const verified = requiresVerification({
        policy: { ...defaultPolicy, requireVerifiedExperience: true },
        entryMode: "invite",
        tokenPresent: true,
      });
      expect(verified).toBe(true);
    });

    it("returns false when policy does not require verified experience", () => {
      const verified = requiresVerification({
        policy: { ...defaultPolicy, requireVerifiedExperience: false },
        entryMode: "invite",
        tokenPresent: true,
      });
      expect(verified).toBe(false);
    });

    it("returns false for open-qr entry mode when policy does not require verification", () => {
      const verified = requiresVerification({
        policy: { ...defaultPolicy, requireVerifiedExperience: false },
        entryMode: "open-qr",
        tokenPresent: false,
      });
      expect(verified).toBe(false);
    });
  });

  describe("availableActions", () => {
    it("returns intersection of tenant enabled and style supported commands", () => {
      const result = availableActions({
        tenantEnabled: ["generate", "paraphrase", "reformat"],
        styleSupported: ["generate", "reformat"],
      });

      expect(result.available).toEqual(["generate", "reformat"]);
      expect(result.excluded).toEqual([
        {
          command: "paraphrase",
          reason: "Not supported by the selected review format.",
        },
      ]);
    });

    it("explains why an action is excluded when disabled by tenant", () => {
      const result = availableActions({
        tenantEnabled: ["generate"],
        styleSupported: ["generate", "expand"],
      });

      expect(result.available).toEqual(["generate"]);
      expect(result.excluded).toEqual([
        {
          command: "expand",
          reason: "Not enabled by the tenant.",
        },
      ]);
    });

    it("handles multiple excluded commands with specific reasons", () => {
      const result = availableActions({
        tenantEnabled: ["generate", "condense"],
        styleSupported: ["generate", "expand"],
      });

      expect(result.available).toEqual(["generate"]);
      expect(result.excluded).toContainEqual({
        command: "condense",
        reason: "Not supported by the selected review format.",
      });
      expect(result.excluded).toContainEqual({
        command: "expand",
        reason: "Not enabled by the tenant.",
      });
    });
  });

  describe("Tenant posture comparison and immutability", () => {
    it("supports dental posture with required disclosure and verified visit", () => {
      const dentalPolicy: PolicyInput = {
        requireDisclosure: true,
        requireVerifiedExperience: true,
        maxReviewFormatsPerRequest: 2,
        bannedTerms: ["guaranteed result"],
      };

      const result = applyPolicy({
        draft: "Dr. Smith explained everything clearly.",
        claims: [{ id: "c1", text: "Dr. Smith explained everything." }],
        policy: dentalPolicy,
        tenantName: "Apex Dental",
        locale: "en-GB",
        disclosurePolicyVersionId: "tenant-policy-r9",
      });

      expect(result.draft).toContain(
        "Review generated with AI assistance on behalf of Apex Dental.",
      );
      expect(
        requiresVerification({
          policy: dentalPolicy,
          entryMode: "invite",
          tokenPresent: true,
        }),
      ).toBe(true);
    });

    it("supports restaurant posture with no disclosure and walk-in open-qr mode", () => {
      const restaurantPolicy: PolicyInput = {
        requireDisclosure: false,
        requireVerifiedExperience: false,
        maxReviewFormatsPerRequest: 3,
        bannedTerms: [],
      };

      const result = applyPolicy({
        draft: "The schnitzel was crispy and delicious.",
        claims: [{ id: "c1", text: "The schnitzel was crispy." }],
        policy: restaurantPolicy,
        tenantName: "Brauhaus Berlin",
        locale: "de-DE",
      });

      expect(result.appended).toBeUndefined();
      expect(
        requiresVerification({
          policy: restaurantPolicy,
          entryMode: "open-qr",
          tokenPresent: false,
        }),
      ).toBe(false);
    });
  });
});
