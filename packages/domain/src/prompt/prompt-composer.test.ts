import { describe, expect, it } from "vitest";

import {
  buildConfigSnapshot,
  type BuildConfigSnapshotInput,
  type FactOption,
  type PriceRate,
  type ReviewFormatVersion,
} from "../configuration/index.js";
import {
  BUILT_IN_FORMATS,
  getBuiltInFormat,
} from "../review-format/index.js";
import {
  composePrompt,
  OUTPUT_SCHEMA,
  type ComposePromptInput,
} from "./index.js";

const tenantFact = (overrides: Partial<FactOption> = {}): FactOption => ({
  id: "fact-service",
  version: "fact-service-v1",
  owner: { scope: "tenant", tenantId: "tenant-a" },
  categoryId: "service",
  proposition: "The service was attentive.",
  polarity: "positive",
  locale: "en-GB",
  active: true,
  sortOrder: 10,
  ...overrides,
});

const conciseFormat: ReviewFormatVersion = {
  id: "format-concise-v1",
  key: "concise-blurb",
  version: "1.0.0",
  displayName: "Concise blurb",
  targetPlatform: "google",
  locale: "any",
  description: { "de-DE": "Kurz.", "en-GB": "Brief." },
  sample: { "en-GB": "Attentive service." },
  constraints: {
    minChars: 40,
    maxChars: 420,
    paragraphs: 1,
    emojiPolicy: "none",
    secondPerson: false,
  },
  supportedCommands: ["reformat", "generate", "paraphrase"],
};

const anthropicRate: PriceRate = {
  id: "rate-anthropic-sonnet-2026-08",
  provider: "anthropic",
  model: "claude-sonnet",
  inputPerMillionMicros: 3_000_000,
  outputPerMillionMicros: 15_000_000,
  currency: "EUR",
  unit: "token",
  effectiveFrom: "2026-08-01T00:00:00.000Z",
  effectiveTo: null,
};

const makeSnapshotInput = (): BuildConfigSnapshotInput => ({
  platform: {
    id: "platform",
    revision: "platform-r1",
    defaults: {
      locale: "en-GB",
      toneGuidelines: "Neutral and plain.",
      entryMode: "invite",
      requireDisclosure: false,
      requireVerifiedExperience: false,
      maxReviewFormatsPerRequest: 2,
      bannedTerms: [],
      enabledReviewFormatVersionIds: [],
      enabledCommands: ["generate"],
      monthlyBudgetMicros: 1_000_000,
      alertThresholdPct: 80,
    },
  },
  tenant: {
    id: "tenant-a",
    revision: "tenant-r7",
    settings: {
      toneGuidelines: "Warm and professional.",
      requireDisclosure: true,
      maxReviewFormatsPerRequest: 2,
      bannedTerms: ["best ever", "guaranteed"],
      enabledReviewFormatVersionIds: ["format-concise-v1"],
      enabledCommands: [
        "generate",
        "paraphrase",
        "reformat",
        "condense",
        "expand",
        "revise-wording",
      ],
    },
    factOptions: [tenantFact()],
  },
  location: {
    id: "location-a",
    tenantId: "tenant-a",
    revision: "location-r3",
    overrides: {},
    factOptionAdditions: [],
  },
  tenantName: "Apex Dental",
  locationName: "Central Clinic",
  reviewFormats: [conciseFormat],
  promptVersions: [
    {
      hash: "prompt-gen-v1",
      key: "review.generate",
      commandKind: "generate",
      body: "Draft an authentic customer review based strictly on the confirmed evidence.",
      variables: ["tone", "locale"],
    },
    {
      hash: "prompt-ref-v1",
      key: "review.reformat",
      commandKind: "reformat",
      body: "Reformat the review into the specified target structure while preserving all facts.",
      variables: ["format", "locale"],
    },
  ],
  priceRates: [anthropicRate],
  providerRouting: {
    version: "routing-v1",
    primaryProvider: "anthropic",
    primaryModel: "claude-sonnet",
  },
});

const defaultSnapshot = buildConfigSnapshot(makeSnapshotInput());
const defaultStyle = getBuiltInFormat("concise-blurb");
const defaultPromptVersion = defaultSnapshot.promptVersions[0]!;

describe("TS-08 Prompt Composition", () => {
  it("composes deterministic generate prompt with output schema", () => {
    const input: ComposePromptInput = {
      snapshot: defaultSnapshot,
      style: defaultStyle,
      promptVersion: defaultPromptVersion,
      action: "generate",
      assertions: [
        { id: "a1", proposition: "The hygienist was gentle." },
        { id: "a2", proposition: "The clinic was immaculate." },
      ],
      freeText: "Appointment started right on time.",
    };

    const composed = composePrompt(input);

    expect(composed.system).toContain(defaultPromptVersion.body);
    expect(composed.system).toContain("Warm and professional.");
    expect(composed.system).toContain("best ever, guaranteed");
    expect(composed.system).toContain(defaultStyle.promptFragments.styleGuide);
    expect(composed.system).toContain("Emoji policy: none");
    expect(composed.outputSchema).toEqual(OUTPUT_SCHEMA);
    expect(composed.messages.length).toBeGreaterThanOrEqual(1);

    const userMessage = composed.messages[composed.messages.length - 1]!;
    expect(userMessage.role).toBe("user");
    expect(userMessage.content).toContain("The hygienist was gentle.");
    expect(userMessage.content).toContain("Appointment started right on time.");
  });

  it("composes paraphrase prompt with source text", () => {
    const input: ComposePromptInput = {
      snapshot: defaultSnapshot,
      style: defaultStyle,
      promptVersion: {
        hash: "prompt-para-v1",
        key: "review.paraphrase",
        commandKind: "paraphrase",
        body: "Paraphrase the reviewer's text preserving every underlying factual proposition.",
        variables: ["locale"],
      },
      action: "paraphrase",
      sourceText: "Really great doctor and clean place overall.",
    };

    const composed = composePrompt(input);
    const userMessage = composed.messages[composed.messages.length - 1]!;
    expect(userMessage.content).toContain(
      "Really great doctor and clean place overall.",
    );
  });

  it("places ceiling constraint in the system message for reformat action", () => {
    const input: ComposePromptInput = {
      snapshot: defaultSnapshot,
      style: defaultStyle,
      promptVersion: defaultSnapshot.promptVersions[1]!,
      action: "reformat",
      sourceGeneration: {
        draft: "Friendly staff and clean clinic.",
        claims: [
          { id: "c1", text: "Friendly staff" },
          { id: "c2", text: "Clean clinic" },
        ],
      },
    };

    const composed = composePrompt(input);
    expect(composed.system).toContain(
      "Ceiling constraint: The source claim set is a hard ceiling.",
    );

    const userMessage = composed.messages[composed.messages.length - 1]!;
    expect(userMessage.content).not.toContain("Ceiling constraint");
    expect(userMessage.content).toContain("Friendly staff and clean clinic.");
  });

  it("composes condense prompt with targetLength and ceiling constraint", () => {
    const input: ComposePromptInput = {
      snapshot: defaultSnapshot,
      style: defaultStyle,
      promptVersion: {
        ...defaultPromptVersion,
        commandKind: "condense",
      },
      action: "condense",
      sourceGeneration: {
        draft: "Thorough consultation and friendly assistants throughout.",
        claims: [{ id: "c1", text: "Thorough consultation" }],
      },
      targetLength: 80,
    };

    const composed = composePrompt(input);
    expect(composed.system).toContain("Ceiling constraint");
    const userMessage = composed.messages[composed.messages.length - 1]!;
    expect(userMessage.content).toContain("Target length: 80 characters");
  });

  it("composes expand prompt with targetLength and ceiling constraint", () => {
    const detailedStyle = getBuiltInFormat("detailed-narrative");
    const input: ComposePromptInput = {
      snapshot: defaultSnapshot,
      style: detailedStyle,
      promptVersion: {
        ...defaultPromptVersion,
        commandKind: "expand",
      },
      action: "expand",
      sourceGeneration: {
        draft: "Dr. Miller was attentive and punctual.",
        claims: [
          { id: "c1", text: "Dr. Miller attentive" },
          { id: "c2", text: "Dr. Miller punctual" },
        ],
      },
      targetLength: 350,
    };

    const composed = composePrompt(input);
    expect(composed.system).toContain("Ceiling constraint");
    const userMessage = composed.messages[composed.messages.length - 1]!;
    expect(userMessage.content).toContain("Target length: 350 characters");
  });

  it("composes revise-wording prompt with instruction", () => {
    const input: ComposePromptInput = {
      snapshot: defaultSnapshot,
      style: defaultStyle,
      promptVersion: {
        ...defaultPromptVersion,
        commandKind: "revise-wording",
      },
      action: "revise-wording",
      sourceGeneration: {
        draft: "The treatment was efficient.",
        claims: [{ id: "c1", text: "Treatment was efficient" }],
      },
      instruction: "Make the tone more warm and reassuring.",
    };

    const composed = composePrompt(input);
    expect(composed.system).toContain("Ceiling constraint");
    const userMessage = composed.messages[composed.messages.length - 1]!;
    expect(userMessage.content).toContain(
      "Instruction: Make the tone more warm and reassuring.",
    );
  });

  it("demands structured draft and claims with assertion provenance in outputSchema", () => {
    const input: ComposePromptInput = {
      snapshot: defaultSnapshot,
      style: defaultStyle,
      promptVersion: defaultPromptVersion,
      action: "generate",
    };

    const composed = composePrompt(input);
    expect(composed.outputSchema).toMatchObject({
      type: "object",
      properties: {
        draft: { type: "string" },
        claims: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              text: { type: "string" },
              assertionIds: { type: "array", items: { type: "string" } },
            },
            required: ["id", "text", "assertionIds"],
          },
        },
      },
      required: ["draft", "claims"],
    });
  });

  it("handles empty free text gracefully", () => {
    const input: ComposePromptInput = {
      snapshot: defaultSnapshot,
      style: defaultStyle,
      promptVersion: defaultPromptVersion,
      action: "generate",
      freeText: "   ",
      assertions: [{ id: "a1", proposition: "Clean reception." }],
    };

    const composed = composePrompt(input);
    const userMessage = composed.messages[composed.messages.length - 1]!;
    expect(userMessage.content).not.toContain("Free text:");
  });

  it("omits banned terms section when banned terms list is empty", () => {
    const inputNoBanned = makeSnapshotInput();
    inputNoBanned.tenant = {
      ...inputNoBanned.tenant,
      settings: {
        ...inputNoBanned.tenant.settings,
        bannedTerms: [],
      },
    };
    const snapshot = buildConfigSnapshot(inputNoBanned);

    const composed = composePrompt({
      snapshot,
      style: defaultStyle,
      promptVersion: defaultPromptVersion,
      action: "generate",
    });

    expect(composed.system).not.toContain("Banned terms:");
  });

  it("includes emoji allowed instruction when style allows emojis", () => {
    const socialStyle = getBuiltInFormat("social-short");
    const composed = composePrompt({
      snapshot: defaultSnapshot,
      style: socialStyle,
      promptVersion: defaultPromptVersion,
      action: "generate",
    });

    expect(composed.system).toContain("Emoji policy: allowed");
  });

  it("selects German description and sample when snapshot locale is de-DE", () => {
    const germanSnapshotInput = makeSnapshotInput();
    germanSnapshotInput.platform = {
      ...germanSnapshotInput.platform,
      defaults: {
        ...germanSnapshotInput.platform.defaults,
        locale: "de-DE",
      },
    };
    germanSnapshotInput.tenant = {
      ...germanSnapshotInput.tenant,
      settings: {
        ...germanSnapshotInput.tenant.settings,
        locale: "de-DE",
      },
    };
    const germanSnapshot = buildConfigSnapshot(germanSnapshotInput);

    const composed = composePrompt({
      snapshot: germanSnapshot,
      style: defaultStyle,
      promptVersion: defaultPromptVersion,
      action: "generate",
    });

    expect(composed.system).toContain("Language: de-DE");
    expect(composed.system).toContain("Kurze, sachliche Ein-Absatz-Bewertung.");
  });

  it("embeds fewShot examples from the style manifest into message turns", () => {
    const composed = composePrompt({
      snapshot: defaultSnapshot,
      style: defaultStyle,
      promptVersion: defaultPromptVersion,
      action: "generate",
    });

    // Contains few-shot user and assistant messages
    const fewShotUser = composed.messages.find(
      (m) => m.content === "service was good, doctor friendly",
    );
    expect(fewShotUser).toBeDefined();
    expect(fewShotUser?.role).toBe("user");
  });

  it("produces byte-identical output deterministically regardless of assertion insertion order", () => {
    const inputA: ComposePromptInput = {
      snapshot: defaultSnapshot,
      style: defaultStyle,
      promptVersion: defaultPromptVersion,
      action: "generate",
      assertions: [
        { id: "a1", proposition: "Punctual staff." },
        { id: "a2", proposition: "Clean waiting room." },
      ],
    };

    const inputB: ComposePromptInput = {
      ...inputA,
      assertions: [
        { id: "a2", proposition: "Clean waiting room." },
        { id: "a1", proposition: "Punctual staff." },
      ],
    };

    const composedA = composePrompt(inputA);
    const composedB = composePrompt(inputB);

    expect(JSON.stringify(composedA)).toBe(JSON.stringify(composedB));
  });

  it("all 3 built-in formats compose valid prompts for all their supported commands", () => {
    for (const style of BUILT_IN_FORMATS) {
      for (const cmd of style.supportedCommands) {
        const composed = composePrompt({
          snapshot: defaultSnapshot,
          style,
          promptVersion: defaultPromptVersion,
          action: cmd,
          assertions: [{ id: "a1", proposition: "Great visit." }],
          sourceText: "Great visit.",
          sourceGeneration: {
            draft: "Great visit.",
            claims: [{ id: "c1", text: "Great visit." }],
          },
        });

        expect(composed.system.length).toBeGreaterThan(50);
        expect(composed.messages.length).toBeGreaterThan(0);
        expect(composed.outputSchema).toEqual(OUTPUT_SCHEMA);
      }
    }
  });
});
