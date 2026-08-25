import type { EffectiveConfigurationSnapshotDto } from "@review/contracts/shared";
import type { ConsoleBenchInputDto } from "@review/contracts/console";
import type { OperatorAccessProjectionDto } from "@review/contracts/context";
import { deriveConfigSnapshotId } from "@review/domain/configuration";
import { describe, expect, it } from "vitest";

import {
  createFakeConsoleStore,
  defaultTenantSettings,
  type FakeConsoleData,
} from "./console-store.test-support.js";
import {
  createConsoleBenchAuthorizer,
  type ConsoleBenchAuthority,
} from "./console-bench-authorizer.js";

const identity = {
  issuer: "https://issuer.example.test",
  subject: "operator-subject",
  email: "operator@example.test",
} as const;

const access: OperatorAccessProjectionDto = {
  status: "authorized",
  operator: { id: "operator-a", email: identity.email },
  platformGrants: [],
  tenantGrants: [
    {
      tenantId: "tenant-a",
      tenantSlug: "tenant-a",
      tenantName: "Tenant A",
      roleKey: "ai-operator",
      capabilities: ["console:read", "ai:operate"],
      locations: [
        {
          locationId: "location-a",
          locationSlug: "location-a",
          locationName: "Location A",
          status: "active",
        },
      ],
    },
  ],
};

const snapshot: EffectiveConfigurationSnapshotDto = {
  snapshotId: "snapshot-a",
  schemaVersion: 2,
  tenantId: "tenant-a",
  locationId: "location-a",
  tenantName: "Tenant A",
  locationName: "Location A",
  settings: {
    locale: "en-GB",
    toneGuidelines: "Warm and specific.",
    entryMode: "invite",
    requireDisclosure: false,
    requireVerifiedExperience: false,
    maxReviewFormatsPerRequest: 1,
    minimumFactSelections: 1,
    maximumCustomerAssertionChars: 4000,
    bannedTerms: [],
    enabledReviewFormatVersionIds: ["format-a@1"],
    enabledCommands: ["generate", "paraphrase"],
    monthlyBudgetMicros: 0,
    alertThresholdPct: 80,
  },
  provenance: {},
  factOptions: [
    {
      id: "fact-tenant",
      version: "fact-tenant@1",
      owner: { scope: "tenant", tenantId: "tenant-a" },
      proposition: "The team was attentive.",
      categoryId: "service",
      polarity: "positive",
      locale: "en-GB",
      active: true,
      sortOrder: 1,
    },
    {
      id: "fact-other-location",
      version: "fact-other-location@1",
      owner: {
        scope: "location",
        tenantId: "tenant-a",
        locationId: "location-b",
      },
      proposition: "This must not cross locations.",
      categoryId: "service",
      polarity: "positive",
      locale: "en-GB",
      active: true,
      sortOrder: 2,
    },
  ],
  reviewFormats: [
    {
      id: "format-a@1",
      key: "short",
      version: "1.0.0",
      displayName: "Short",
      targetPlatform: "google",
      locale: "any",
      description: { "en-GB": "Short review" },
      sample: { "en-GB": "The team was attentive." },
      constraints: {
        minChars: 1,
        maxChars: 400,
        paragraphs: 1,
        emojiPolicy: "none",
        secondPerson: false,
      },
      supportedCommands: ["generate", "paraphrase"],
    },
  ],
  promptVersions: [
    {
      id: "prompt-generate@1",
      hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      key: "review.generate",
      commandKind: "generate",
      body: "Use only Assertions.",
      variables: [],
    },
    {
      id: "prompt-paraphrase@1",
      hash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      key: "review.paraphrase",
      commandKind: "paraphrase",
      body: "Paraphrase only Assertions.",
      variables: [],
    },
  ],
  priceRates: [
    {
      id: "price-fake@1",
      providerModelId: "provider-model-fake-v1",
      provider: "fake",
      model: "fake-v1",
      inputPerMillionMicros: 0,
      outputPerMillionMicros: 0,
      currency: "EUR",
      unit: "token",
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveTo: "2026-02-01T00:00:00.000Z",
    },
  ],
  providerRouting: {
    version: "routing-v1",
    providerModelId: "provider-model-fake-v1",
    primaryProvider: "fake",
    primaryModel: "fake-v1",
  },
};

const snapshotHash = deriveConfigSnapshotId(snapshot);

function data(contentHash = snapshotHash): FakeConsoleData {
  return {
    tenants: [
      {
        id: "tenant-a",
        slug: "tenant-a",
        name: "Tenant A",
        locale: "en-GB",
        platformDefaults: defaultTenantSettings("en-GB"),
        tenantValues: defaultTenantSettings("en-GB"),
        settings: defaultTenantSettings("en-GB"),
        keywordCategories: [],
        category: "Dental",
        plan: "student",
        monthlyBudgetMicros: 0,
        monthToDateSpendMicros: 0,
        status: "active",
      },
    ],
    locations: [
      {
        id: "location-a",
        tenantId: "tenant-a",
        slug: "location-a",
        name: "Location A",
        address: {
          line1: "1 Street",
          line2: "",
          postalCode: "10115",
          city: "Berlin",
          country: "DE",
        },
        active: true,
        overrides: {},
      },
    ],
    contextVersions: [],
    keywords: [],
    styles: [],
    actions: [],
    prompts: [],
    experiments: [],
    destinations: [],
    publishedSnapshots: [
      {
        tenantId: "tenant-a",
        locationId: "location-a",
        contentHash,
        payload: snapshot,
      },
    ],
  };
}

function setup(contentHash = snapshotHash) {
  const signed: Parameters<ConsoleBenchAuthority["signBench"]>[0][] = [];
  const authority: ConsoleBenchAuthority = {
    signBench(input) {
      signed.push(input);
      return "signed-bench-receipt";
    },
  };
  let id = 0;
  const authorizer = createConsoleBenchAuthorizer({
    store: createFakeConsoleStore(data(contentHash)),
    authority,
    resolveAccess: async () => access,
    now: () => new Date("2026-08-24T10:00:00.000Z"),
    newId: () => `bench-id-${++id}`,
  });
  return { authorizer, signed };
}

const generateInput: ConsoleBenchInputDto = {
  action: "generate",
  styleId: "format-a@1",
  promptVersionId: "prompt-generate@1",
  provider: "fake",
  keywordIds: ["fact-tenant"],
  freeText: "",
  sourceText: "",
  rating: 5,
};

describe("Console Bench authorization", () => {
  it("binds one current published snapshot and owned Fact Options into an immutable workload", async () => {
    const { authorizer, signed } = setup();

    const result = await authorizer.authorize({
      identity,
      scope: { tenantId: "tenant-a", locationId: "location-a" },
      input: generateInput,
    });

    expect(result).toMatchObject({
      status: "authorized",
      receipt: "signed-bench-receipt",
      workload: {
        bindings: {
          tenantId: "tenant-a",
          locationId: "location-a",
          action: "generate",
          reviewFormatVersionId: "format-a@1",
          snapshotId: "snapshot-a",
          snapshotHash,
          providerModelId: "provider-model-fake-v1",
          priceRateId: "price-fake@1",
        },
        command: { kind: "generate", rating: 5 },
        assertions: [
          {
            proposition: "The team was attentive.",
            source: {
              kind: "fact-option",
              factOptionId: "fact-tenant",
              factOptionVersion: "fact-tenant@1",
            },
          },
        ],
      },
    });
    expect(signed).toHaveLength(1);
    expect(signed[0]).toMatchObject({ isBench: true });
  });

  const deniedCases: readonly [
    string,
    { readonly tenantId: string | null; readonly locationId: string | null },
    ConsoleBenchInputDto,
  ][] = [
    ["a tenant-only request", { tenantId: "tenant-a", locationId: null }, generateInput],
    [
      "a crossed Tenant/Location pair",
      { tenantId: "tenant-b", locationId: "location-a" },
      generateInput,
    ],
    [
      "a Fact Option owned by another Location",
      { tenantId: "tenant-a", locationId: "location-a" },
      { ...generateInput, keywordIds: ["fact-other-location"] },
    ],
    [
      "a paid provider",
      { tenantId: "tenant-a", locationId: "location-a" },
      { ...generateInput, provider: "openai" },
    ],
    [
      "an unsupported transformation without immutable source evidence",
      { tenantId: "tenant-a", locationId: "location-a" },
      { ...generateInput, action: "expand" },
    ],
  ];

  it.each(deniedCases)("returns one generic denial for %s before signing", async (_label, scope, input) => {
    const { authorizer, signed } = setup();
    expect(await authorizer.authorize({ identity, scope, input })).toEqual({
      status: "not-found",
    });
    expect(signed).toHaveLength(0);
  });

  it("does not advertise Paraphrase until its semantic no-new-proposition validator exists", async () => {
    const { authorizer, signed } = setup();
    const result = await authorizer.authorize({
      identity,
      scope: { tenantId: "tenant-a", locationId: "location-a" },
      input: {
        ...generateInput,
        action: "paraphrase",
        promptVersionId: "prompt-paraphrase@1",
        keywordIds: [],
        sourceText: "The appointment started on time.",
      },
    });

    expect(result).toEqual({ status: "not-found" });
    expect(signed).toHaveLength(0);
  });

  it("does not sign a snapshot whose stored content hash is not canonical", async () => {
    const { authorizer, signed } = setup(
      "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    );
    expect(
      await authorizer.authorize({
        identity,
        scope: { tenantId: "tenant-a", locationId: "location-a" },
        input: generateInput,
      }),
    ).toEqual({ status: "not-found" });
    expect(signed).toHaveLength(0);
  });
});
