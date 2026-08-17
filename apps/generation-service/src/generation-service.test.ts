import {
  buildConfigSnapshot,
  type BuildConfigSnapshotInput,
  type FactOption,
  type PriceRate,
  type ReviewFormatVersion,
} from "@review/domain/configuration";
import { FakeModelGateway } from "@review/llm";
import { describe, expect, it } from "vitest";

import type { GenerationRequest } from "./application/orchestrator.js";
import { createGenerationApp } from "./transport/http/routes.js";

const sampleFact: FactOption = {
  id: "fact-1",
  version: "fact-1-v1",
  owner: { scope: "tenant", tenantId: "tenant-a" },
  categoryId: "service",
  proposition: "Attentive hygienist.",
  polarity: "positive",
  locale: "en-GB",
  active: true,
  sortOrder: 1,
};

const sampleFormat: ReviewFormatVersion = {
  id: "format-concise-v1",
  key: "concise-blurb",
  version: "1.0.0",
  displayName: "Concise blurb",
  targetPlatform: "google",
  locale: "any",
  description: { "en-GB": "Brief review." },
  sample: { "en-GB": "Attentive hygienist." },
  constraints: {
    minChars: 20,
    maxChars: 400,
    paragraphs: 1,
    emojiPolicy: "none",
    secondPerson: false,
  },
  supportedCommands: ["generate", "reformat"],
};

const sampleRate: PriceRate = {
  id: "rate-anthropic-sonnet-2026-08",
  providerModelId: "provider-model-anthropic-sonnet",
  provider: "anthropic",
  model: "claude-sonnet",
  inputPerMillionMicros: 3_000_000,
  outputPerMillionMicros: 15_000_000,
  currency: "EUR",
  unit: "token",
  effectiveFrom: "2026-08-01T00:00:00.000Z",
  effectiveTo: null,
};

const snapshotInput: BuildConfigSnapshotInput = {
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
      enabledReviewFormatVersionIds: ["format-concise-v1"],
      enabledCommands: ["generate", "reformat"],
      monthlyBudgetMicros: 1_000_000,
      alertThresholdPct: 80,
    },
  },
  tenant: {
    id: "tenant-a",
    revision: "tenant-r1",
    settings: {
      toneGuidelines: "Warm and professional.",
      requireDisclosure: false,
      maxReviewFormatsPerRequest: 2,
      bannedTerms: [],
      enabledReviewFormatVersionIds: ["format-concise-v1"],
      enabledCommands: ["generate", "reformat"],
    },
    factOptions: [sampleFact],
  },
  location: {
    id: "location-a",
    tenantId: "tenant-a",
    revision: "location-r1",
    overrides: {},
    factOptionAdditions: [],
  },
  tenantName: "Apex Dental",
  locationName: "Central Clinic",
  reviewFormats: [sampleFormat],
  promptVersions: [
    {
      hash: "prompt-gen-v1",
      key: "review.generate",
      commandKind: "generate",
      body: "Draft an authentic customer review.",
      variables: ["tone", "locale"],
    },
  ],
  priceRates: [sampleRate],
  providerRouting: {
    version: "routing-v1",
    providerModelId: "provider-model-anthropic-sonnet",
    primaryProvider: "anthropic",
    primaryModel: "claude-sonnet",
  },
};

const defaultSnapshot = buildConfigSnapshot(snapshotInput);

describe("TS-16 Generation Service Execution Plane", () => {
  it("orchestrates end-to-end generation with grounding guard verification", async () => {
    const fakeGateway = new FakeModelGateway([
      {
        outcome: "success",
        run: {
          output: {
            draft: "The hygienist was very attentive throughout the visit.",
            claims: [
              {
                id: "c1",
                text: "The hygienist was very attentive.",
                assertionIds: ["a1"],
              },
            ],
          },
          attempt: {
            provider: "anthropic",
            model: "claude-sonnet",
            usage: { inputTokens: 100, outputTokens: 20 },
            receipt: { requestId: "req-1", finishReason: "stop" },
          },
        },
      },
    ]);

    const app = createGenerationApp({ gateway: fakeGateway });

    const requestBody: GenerationRequest = {
      idempotencyKey: "idem-1",
      reviewSessionId: "session-1",
      action: "generate",
      reviewFormatKey: "concise-blurb",
      snapshot: defaultSnapshot,
      assertions: [
        {
          id: "a1",
          version: "a1-v1",
          reviewSessionId: "session-1",
          semanticId: "service-hygienist",
          semanticKind: "experience-fact",
          polarity: "positive",
          source: {
            kind: "fact-option",
            factOptionId: "fact-1",
            factOptionVersion: "fact-1-v1",
          },
        },
      ],
    };

    const res = await app.request("/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    expect(res.status).toBe(200);
    const result = await res.json();
    expect(result.status).toBe("completed");
    expect(result.draft).toContain("hygienist was very attentive");
    expect(result.groundingVerdict.verdict).toBe("pass");
    expect(result.costMicros).toBeGreaterThan(0);
    expect(result.cached).toBe(false);
  });

  it("replays cached generation result without re-calling gateway when idempotencyKey matches", async () => {
    const fakeGateway = new FakeModelGateway([
      {
        outcome: "success",
        run: {
          output: {
            draft: "Great service.",
            claims: [{ id: "c1", text: "Great service", assertionIds: ["a1"] }],
          },
          attempt: {
            provider: "anthropic",
            model: "claude-sonnet",
            usage: { inputTokens: 50, outputTokens: 10 },
            receipt: { requestId: "req-idem-1", finishReason: "stop" },
          },
        },
      },
    ]);

    const app = createGenerationApp({ gateway: fakeGateway });

    const requestBody: GenerationRequest = {
      idempotencyKey: "idem-replay-key",
      reviewSessionId: "session-1",
      action: "generate",
      reviewFormatKey: "concise-blurb",
      snapshot: defaultSnapshot,
      assertions: [
        {
          id: "a1",
          version: "a1-v1",
          reviewSessionId: "session-1",
          semanticId: "service",
          semanticKind: "experience-fact",
          polarity: "positive",
          source: {
            kind: "fact-option",
            factOptionId: "fact-1",
            factOptionVersion: "fact-1-v1",
          },
        },
      ],
    };

    // First call
    const res1 = await app.request("/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });
    const result1 = await res1.json();
    expect(result1.cached).toBe(false);

    // Replay call (gateway has no more scripted steps, would throw if called)
    const res2 = await app.request("/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });
    const result2 = await res2.json();
    expect(result2.cached).toBe(true);
    expect(result2.generationId).toBe(result1.generationId);
  });

  it("stores sourceGenerationId on derived actions to maintain lineage chain", async () => {
    const fakeGateway = new FakeModelGateway([
      {
        outcome: "success",
        run: {
          output: {
            draft: "Reformatted review text.",
            claims: [{ id: "c1", text: "Reformatted review", assertionIds: ["a1"] }],
          },
          attempt: {
            provider: "anthropic",
            model: "claude-sonnet",
            usage: { inputTokens: 80, outputTokens: 15 },
            receipt: { requestId: "req-derived-1", finishReason: "stop" },
          },
        },
      },
    ]);

    const app = createGenerationApp({ gateway: fakeGateway });

    const requestBody: GenerationRequest = {
      idempotencyKey: "idem-derived-1",
      reviewSessionId: "session-1",
      action: "reformat",
      reviewFormatKey: "concise-blurb",
      sourceGenerationId: "gen-parent-123",
      sourceGeneration: {
        draft: "Parent draft",
        claims: [{ id: "c1", text: "Parent claim" }],
      },
      snapshot: defaultSnapshot,
      assertions: [
        {
          id: "a1",
          version: "a1-v1",
          reviewSessionId: "session-1",
          semanticId: "c1",
          semanticKind: "experience-fact",
          polarity: "positive",
          source: {
            kind: "fact-option",
            factOptionId: "fact-1",
            factOptionVersion: "fact-1-v1",
          },
        },
      ],
    };

    const res = await app.request("/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    const result = await res.json();
    expect(result.sourceGenerationId).toBe("gen-parent-123");
  });

  it("never returns candidate bytes when the grounding guard rejects them", async () => {
    const fakeGateway = new FakeModelGateway([
      {
        outcome: "success",
        run: {
          output: {
            draft: "The staff gave me a free upgrade.",
            claims: [
              {
                id: "unsupported-claim",
                text: "The staff gave me a free upgrade.",
                assertionIds: ["missing-assertion"],
              },
            ],
          },
          attempt: {
            provider: "fake",
            model: "fake-v1",
            usage: { inputTokens: 50, outputTokens: 12 },
            receipt: { requestId: "req-unsafe", finishReason: "stop" },
          },
        },
      },
    ]);
    const app = createGenerationApp({ gateway: fakeGateway });

    const response = await app.request("/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: "idem-unsafe",
        reviewSessionId: "session-1",
        action: "generate",
        reviewFormatKey: "concise-blurb",
        snapshot: defaultSnapshot,
        assertions: [
          {
            id: "a1",
            version: "a1-v1",
            reviewSessionId: "session-1",
            semanticId: "service",
            semanticKind: "experience-fact",
            polarity: "positive",
            source: {
              kind: "fact-option",
              factOptionId: "fact-1",
              factOptionVersion: "fact-1-v1",
            },
          },
        ],
      }),
    });
    const responseText = await response.text();

    expect(response.status).toBe(422);
    expect(responseText).not.toContain("free upgrade");
    expect(JSON.parse(responseText)).toEqual({
      status: "failed",
      code: "GROUNDING_REJECTED",
    });
  });

  it("projects unexpected failures without exposing internal or Tenant details", async () => {
    const app = createGenerationApp({
      orchestrator: {
        generate: () =>
          Promise.reject(
            new Error(
              "tenant-a provider key sk-live-secret failed at postgres://internal-host",
            ),
          ),
      },
    });

    const response = await app.request("/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const responseText = await response.text();

    expect(response.status).toBe(500);
    expect(responseText).not.toContain("tenant-a");
    expect(responseText).not.toContain("sk-live-secret");
    expect(responseText).not.toContain("internal-host");
    expect(JSON.parse(responseText)).toEqual({
      status: "failed",
      code: "GENERATION_FAILED",
    });
  });
});
