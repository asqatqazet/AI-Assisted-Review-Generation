import { createHash, generateKeyPairSync } from "node:crypto";

import type { EffectiveConfigurationSnapshotDto } from "../packages/contracts/src/shared/index.js";
import { deriveConfigSnapshotId } from "../packages/domain/src/configuration/index.js";
import { describe, expect, it } from "vitest";

import { createConsoleBenchAuthorizer } from "../apps/context-service/src/console/console-bench-authorizer.js";
import { createConsoleBenchAuthority } from "../apps/context-service/src/console/console-bench-authority.js";
import {
  createFakeConsoleStore,
  defaultTenantSettings,
  type FakeConsoleData,
} from "../apps/context-service/src/console/console-store.test-support.js";
import { createContextFunctionHandler } from "../apps/context-service/src/context-function.js";
import { createPaidWorkAttemptPreparer } from "../apps/generation-service/src/application/paid-work-attempt.js";
import {
  createConsoleBenchHandler,
  createNonPersistentConsoleBenchSink,
} from "../apps/generation-service/src/console-bench-handler.js";
import { createConsoleBenchVerifier } from "../apps/generation-service/src/console-bench-verifier.js";
import { createAssessmentFakeGateway } from "../apps/generation-service/src/runtime.js";
import { createInvokedConsoleBenchAuthorizationPort } from "../apps/web-bff/src/adapters/context-function.port.js";
import { createInvokedConsoleBenchExecutionPort } from "../apps/web-bff/src/adapters/generation-function.port.js";
import { createWebBffApp } from "../apps/web-bff/src/app.js";

const snapshot: EffectiveConfigurationSnapshotDto = {
  snapshotId: "snapshot-bench-published",
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
    enabledReviewFormatVersionIds: ["format-short@1"],
    enabledCommands: ["generate"],
    monthlyBudgetMicros: 0,
    alertThresholdPct: 80,
  },
  provenance: {},
  factOptions: [
    {
      id: "fact-attentive",
      version: "fact-attentive@1",
      owner: { scope: "tenant", tenantId: "tenant-a" },
      proposition: "The team was attentive.",
      categoryId: "service",
      polarity: "positive",
      locale: "en-GB",
      active: true,
      sortOrder: 1,
    },
    {
      id: "fact-location-b",
      version: "fact-location-b@1",
      owner: {
        scope: "location",
        tenantId: "tenant-a",
        locationId: "location-b",
      },
      proposition: "This belongs to another Location.",
      categoryId: "service",
      polarity: "positive",
      locale: "en-GB",
      active: true,
      sortOrder: 2,
    },
  ],
  reviewFormats: [
    {
      id: "format-short@1",
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
      supportedCommands: ["generate"],
    },
  ],
  promptVersions: [
    {
      id: "prompt-generate@1",
      hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      key: "review.generate",
      commandKind: "generate",
      body: "Use only the reviewer-confirmed Assertions.",
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
      effectiveTo: null,
    },
  ],
  providerRouting: {
    version: "routing-v1",
    providerModelId: "provider-model-fake-v1",
    primaryProvider: "fake",
    primaryModel: "fake-v1",
  },
};

function consoleData(): FakeConsoleData {
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
        contentHash: deriveConfigSnapshotId(snapshot),
        payload: snapshot,
      },
    ],
  };
}

const identity = {
  issuer: "https://issuer.example.test",
  subject: "operator-a",
  email: "operator@example.test",
};

const entryService = {
  prepareEntry: async () => ({ status: "unavailable" as const }),
  readEntryChallenge: async () => ({ status: "unavailable" as const }),
  advanceEntry: async () => ({ status: "unavailable" as const }),
  verifyEntry: async () => ({ status: "unavailable" as const }),
  readReviewSession: async () => ({ status: "unavailable" as const }),
  prepareReviewerDisposition: async () => ({ status: "rejected" as const }),
  prepareReviewerGeneration: async () => ({
    status: "rejected" as const,
    code: "GENERATION_FAILED" as const,
    retryable: false,
  }),
  activateGeneration: async () => ({ status: "rejected" as const }),
  settleGeneration: async () => ({ status: "rejected" as const }),
  listReconciliationCandidates: async () => ({ candidates: [] }),
  releaseReconciledGeneration: async () => ({ status: "rejected" as const }),
};

const payloadHash = (body: string): string =>
  createHash("sha256").update(body).digest("hex");

describe("Console Bench local composition", () => {
  it("runs Context → BFF → Generation → FakeProvider without persistence or billing", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const store = createFakeConsoleStore(consoleData());
    let id = 0;
    const contextHandler = createContextFunctionHandler({
      entryService,
      consoleBenchAuthorizer: createConsoleBenchAuthorizer({
        store,
        authority: createConsoleBenchAuthority({
          consoleAuthorityPrivateKeyPem: privatePem,
        }),
        resolveAccess: async () => ({
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
        }),
        now: () => new Date("2026-08-24T10:00:00.000Z"),
        newId: () => `bench-id-${++id}`,
      }),
    });
    const nonPersistentResults: unknown[] = [];
    let pipelineCalls = 0;
    const generationHandler = createConsoleBenchHandler({
      verifier: createConsoleBenchVerifier({
        consoleAuthorityPublicKeyPem: publicPem,
        now: () => new Date("2026-08-24T10:00:01.000Z"),
      }),
      prepareAttempt: async (workload) => {
        pipelineCalls += 1;
        return await createPaidWorkAttemptPreparer({
          gateway: createAssessmentFakeGateway(workload, { delayMs: 0 }),
        })(workload);
      },
      sink: createNonPersistentConsoleBenchSink({
        record: async (result) => {
          nonPersistentResults.push(result);
        },
      }),
      nowMs: () => 1_000,
      newAttemptId: () => "bench-attempt-a",
    });
    const app = createWebBffApp({
      publicOrigin: "https://console.example.test",
      operatorAuth: {
        begin: async () => ({
          authorizationUrl: "https://issuer.example.test/authorize",
          transactionCookie: "unused",
        }),
        complete: async () => ({ sessionCookie: "unused", returnTo: "/console" }),
        readSession: async () => ({ identity, refreshedSessionCookie: null }),
        logout: async () => ({ logoutUrl: "https://issuer.example.test/logout" }),
      },
      consolePort: { request: async () => ({ status: "not-found" }) },
      consoleBenchAuthorizationPort: createInvokedConsoleBenchAuthorizationPort({
        invoke: contextHandler,
      }),
      consoleBenchExecutionPort: createInvokedConsoleBenchExecutionPort({
        invoke: generationHandler,
      }),
    });

    const request = async (keywordId: string) => {
      const body = JSON.stringify({
        command: "run-bench",
        input: {
          action: "generate",
          styleId: "format-short@1",
          promptVersionId: "prompt-generate@1",
          provider: "fake",
          keywordIds: [keywordId],
          freeText: "",
          sourceText: "",
          rating: 5,
        },
      });
      return await app.request(
        "/api/v1/console/commands?tenantId=tenant-a&locationId=location-a",
        {
          method: "POST",
          headers: {
            Cookie: "__Host-operator_session=valid",
            Origin: "https://console.example.test",
            "x-amz-content-sha256": payloadHash(body),
          },
          body,
        },
      );
    };

    const success = await request("fact-attentive");
    expect(success.status).toBe(200);
    expect(await success.json()).toMatchObject({
      outcome: "bench-result",
      result: {
        output: "The team was attentive.",
        provider: "fake",
        model: "fake-v1",
        estimatedCost: { amountMicros: 0, currency: "EUR" },
        isBench: true,
        guard: { verdict: "passed", removedClaimCount: 0 },
      },
    });
    expect(pipelineCalls).toBe(1);
    expect(nonPersistentResults).toHaveLength(1);

    const crossedSource = await request("fact-location-b");
    expect(crossedSource.status).toBe(404);
    expect(await crossedSource.json()).toMatchObject({ code: "CONSOLE_NOT_FOUND" });
    expect(pipelineCalls).toBe(1);
    expect(nonPersistentResults).toHaveLength(1);
  });
});
