import { describe, expect, it } from "vitest";

import {
  CONFIG_SNAPSHOT_SCHEMA_VERSION,
  buildConfigSnapshot,
  canonicalizeConfigSnapshotPayload,
  type BuildConfigSnapshotInput,
  type FactOption,
  type PriceRate,
  type ReviewFormatVersion,
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

const germanFormat: ReviewFormatVersion = {
  ...conciseFormat,
  id: "format-german-v1",
  key: "german-narrative",
  locale: "de-DE",
  displayName: "Ausführlich",
};

const socialFormat: ReviewFormatVersion = {
  ...conciseFormat,
  id: "format-social-v1",
  key: "social-short",
  displayName: "Social short",
  locale: "en-GB",
  constraints: { ...conciseFormat.constraints, minChars: 20, maxChars: 140 },
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

const openAiRate: PriceRate = {
  id: "rate-openai-mini-2026-08",
  provider: "openai",
  model: "gpt-mini",
  inputPerMillionMicros: 400_000,
  outputPerMillionMicros: 1_600_000,
  currency: "EUR",
  unit: "token",
  effectiveFrom: "2026-08-01T00:00:00.000Z",
  effectiveTo: null,
};

const makeInput = (): BuildConfigSnapshotInput => ({
  platform: {
    id: "platform",
    revision: "platform-r1",
    defaults: {
      locale: "en-GB",
      toneGuidelines: "Neutral and plain.",
      entryMode: "invite",
      requireDisclosure: false,
      requireVerifiedExperience: false,
      maxReviewFormatsPerRequest: 1,
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
      toneGuidelines: "Calm and first person.",
      requireDisclosure: true,
      maxReviewFormatsPerRequest: 2,
      bannedTerms: ["guaranteed", "best ever"],
      enabledReviewFormatVersionIds: ["format-social-v1", "format-concise-v1", "format-german-v1"],
      enabledCommands: ["paraphrase", "generate", "reformat"],
    },
    factOptions: [tenantFact()],
  },
  location: {
    id: "location-a",
    tenantId: "tenant-a",
    revision: "location-r3",
    overrides: { requireVerifiedExperience: true },
    factOptionAdditions: [
      tenantFact({
        id: "fact-parking",
        version: "fact-parking-v2",
        owner: {
          scope: "location",
          tenantId: "tenant-a",
          locationId: "location-a",
        },
        categoryId: "access",
        proposition: "Parking was easy.",
        sortOrder: 20,
      }),
    ],
  },
  tenantName: "Tenant A",
  locationName: "Central",
  reviewFormats: [germanFormat, socialFormat, conciseFormat],
  promptVersions: [
    {
      hash: "prompt-generate-v1",
      key: "review.generate",
      commandKind: "generate",
      body: "Use only supplied evidence.",
      variables: ["tone", "locale"],
    },
    {
      hash: "prompt-reformat-v1",
      key: "review.reformat",
      commandKind: "reformat",
      body: "Preserve every supplied proposition.",
      variables: ["locale", "format"],
    },
  ],
  priceRates: [openAiRate, anthropicRate],
  providerRouting: {
    primaryProvider: "anthropic",
    primaryModel: "claude-sonnet",
  },
});

describe("buildConfigSnapshot", () => {
  it("builds a self-bound snapshot containing the complete resolved execution configuration", () => {
    const snapshot = buildConfigSnapshot(makeInput());

    expect(snapshot).toMatchObject({
      schemaVersion: CONFIG_SNAPSHOT_SCHEMA_VERSION,
      tenantId: "tenant-a",
      locationId: "location-a",
      tenantName: "Tenant A",
      locationName: "Central",
      settings: {
        locale: "en-GB",
        toneGuidelines: "Calm and first person.",
        entryMode: "invite",
        requireDisclosure: true,
        requireVerifiedExperience: true,
        maxReviewFormatsPerRequest: 2,
        bannedTerms: ["best ever", "guaranteed"],
        enabledReviewFormatVersionIds: ["format-concise-v1", "format-german-v1", "format-social-v1"],
        enabledCommands: ["generate", "paraphrase", "reformat"],
        monthlyBudgetMicros: 1_000_000,
        alertThresholdPct: 80,
      },
      factOptions: [
        { id: "fact-service", version: "fact-service-v1" },
        { id: "fact-parking", version: "fact-parking-v2" },
      ],
      reviewFormats: [{ id: "format-concise-v1" }, { id: "format-social-v1" }],
      promptVersions: [{ hash: "prompt-generate-v1" }, { hash: "prompt-reformat-v1" }],
      priceRates: [
        { id: "rate-anthropic-sonnet-2026-08" },
        { id: "rate-openai-mini-2026-08" },
      ],
      providerRouting: {
        primaryProvider: "anthropic",
        primaryModel: "claude-sonnet",
      },
    });
    expect(snapshot.snapshotId).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(Object.keys(snapshot.provenance)).toHaveLength(11);
    expect(snapshot.provenance.requireVerifiedExperience).toEqual({
      scope: "location",
      sourceId: "location-a",
      revision: "location-r3",
    });
  });

  it("returns identical canonical bytes and snapshot id for identical input", () => {
    const first = buildConfigSnapshot(makeInput());
    const second = buildConfigSnapshot(makeInput());

    expect(canonicalizeConfigSnapshotPayload(first)).toBe(
      canonicalizeConfigSnapshotPayload(second),
    );
    expect(second.snapshotId).toBe(first.snapshotId);
  });

  it("ignores object insertion order when deriving the snapshot id", () => {
    const firstInput = makeInput();
    const secondInput = makeInput();
    secondInput.location = {
      ...secondInput.location,
      overrides: {
        requireDisclosure: true,
        requireVerifiedExperience: true,
      },
    };
    firstInput.location = {
      ...firstInput.location,
      overrides: {
        requireVerifiedExperience: true,
        requireDisclosure: true,
      },
    };

    expect(buildConfigSnapshot(secondInput).snapshotId).toBe(
      buildConfigSnapshot(firstInput).snapshotId,
    );
  });

  it("ignores ordering of set-like configuration and catalogue arrays", () => {
    const reordered = makeInput();
    reordered.tenant = {
      ...reordered.tenant,
      settings: {
        ...reordered.tenant.settings,
        bannedTerms: ["best ever", "guaranteed"],
        enabledReviewFormatVersionIds: ["format-german-v1", "format-concise-v1", "format-social-v1"],
        enabledCommands: ["reformat", "generate", "paraphrase"],
      },
    };
    reordered.reviewFormats = [...reordered.reviewFormats].reverse();
    reordered.promptVersions = [...reordered.promptVersions].reverse();
    reordered.priceRates = [...reordered.priceRates].reverse();

    expect(buildConfigSnapshot(reordered).snapshotId).toBe(
      buildConfigSnapshot(makeInput()).snapshotId,
    );
  });

  it("changes identity when one effective banned term changes", () => {
    const changed = makeInput();
    changed.tenant = {
      ...changed.tenant,
      settings: {
        ...changed.tenant.settings,
        bannedTerms: ["guaranteed", "unbeatable"],
      },
    };

    expect(buildConfigSnapshot(changed).snapshotId).not.toBe(
      buildConfigSnapshot(makeInput()).snapshotId,
    );
  });

  it("changes identity when a Location override changes the effective value", () => {
    const inherited = makeInput();
    inherited.location = { ...inherited.location, overrides: {} };

    expect(buildConfigSnapshot(inherited).snapshotId).not.toBe(
      buildConfigSnapshot(makeInput()).snapshotId,
    );
  });

  it("ignores Fact Option input order because resolved sortOrder defines the semantic order", () => {
    const first = makeInput();
    first.tenant = {
      ...first.tenant,
      factOptions: [
        tenantFact({ id: "fact-second", sortOrder: 20 }),
        tenantFact({ id: "fact-first", sortOrder: 10 }),
      ],
    };
    const second = makeInput();
    second.tenant = {
      ...second.tenant,
      factOptions: [...first.tenant.factOptions].reverse(),
    };

    expect(buildConfigSnapshot(second).snapshotId).toBe(
      buildConfigSnapshot(first).snapshotId,
    );
  });

  it("changes identity and output order when Fact Option sortOrder changes", () => {
    const first = makeInput();
    first.tenant = {
      ...first.tenant,
      factOptions: [
        tenantFact({ id: "fact-first", sortOrder: 10 }),
        tenantFact({ id: "fact-second", sortOrder: 20 }),
      ],
    };
    const second = makeInput();
    second.tenant = {
      ...second.tenant,
      factOptions: [
        tenantFact({ id: "fact-first", sortOrder: 30 }),
        tenantFact({ id: "fact-second", sortOrder: 20 }),
      ],
    };

    expect(buildConfigSnapshot(second).snapshotId).not.toBe(
      buildConfigSnapshot(first).snapshotId,
    );
    expect(buildConfigSnapshot(second).factOptions.slice(0, 2).map(({ id }) => id)).toEqual([
      "fact-second",
      "fact-first",
    ]);
  });

  it("includes only enabled Review Format Versions compatible with the effective locale", () => {
    const snapshot = buildConfigSnapshot(makeInput());

    expect(snapshot.reviewFormats.map(({ id }) => id)).toEqual([
      "format-concise-v1",
      "format-social-v1",
    ]);
  });

  it("deep-freezes the snapshot without mutating its inputs", () => {
    const input = makeInput();
    const originalFormatOrder = input.reviewFormats.map(({ id }) => id);
    const snapshot = buildConfigSnapshot(input);

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.settings)).toBe(true);
    expect(Object.isFrozen(snapshot.settings.bannedTerms)).toBe(true);
    expect(Object.isFrozen(snapshot.reviewFormats[0]?.constraints)).toBe(true);
    expect(() => {
      (snapshot.settings.bannedTerms as string[]).push("mutated");
    }).toThrow();
    expect(input.reviewFormats.map(({ id }) => id)).toEqual(originalFormatOrder);
  });

  it("excludes provider credentials even when a structurally compatible caller carries them", () => {
    const input = makeInput();
    input.providerRouting = {
      ...input.providerRouting,
      apiKey: "must-not-enter-snapshot",
    };

    const canonical = canonicalizeConfigSnapshotPayload(buildConfigSnapshot(input));

    expect(canonical).not.toContain("apiKey");
    expect(canonical).not.toContain("must-not-enter-snapshot");
  });

  it("binds identity to schema, Tenant, and Location", () => {
    const base = makeInput();
    const otherLocation = makeInput();
    otherLocation.location = {
      ...otherLocation.location,
      id: "location-b",
      factOptionAdditions: [],
    };
    otherLocation.locationName = "Riverside";

    expect(buildConfigSnapshot(otherLocation).snapshotId).not.toBe(
      buildConfigSnapshot(base).snapshotId,
    );
    expect(canonicalizeConfigSnapshotPayload(buildConfigSnapshot(base))).toContain(
      `"schemaVersion":${CONFIG_SNAPSHOT_SCHEMA_VERSION}`,
    );
  });

  it("changes identity when an immutable Price Rate identity changes", () => {
    const changed = makeInput();
    changed.priceRates = [
      { ...openAiRate, id: "rate-openai-mini-2026-09" },
      anthropicRate,
    ];

    expect(buildConfigSnapshot(changed).snapshotId).not.toBe(
      buildConfigSnapshot(makeInput()).snapshotId,
    );
  });
});
