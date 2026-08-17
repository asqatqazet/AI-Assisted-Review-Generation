import { GenerationWorkloadDtoSchema } from "@review/contracts/generation";
import { describe, expect, it } from "vitest";

import type { ModelGatewayPort } from "../ports/model-gateway.port.js";
import { createPaidWorkAttemptPreparer } from "./paid-work-attempt.js";

const workload = GenerationWorkloadDtoSchema.parse({
  bindings: {
    tenantId: "tenant-a",
    locationId: "location-a",
    reviewSessionId: "session-a",
    generationBatchId: "batch-a",
    generationId: "generation-a",
    action: "generate",
    reviewFormatVersionId: "format-a@1",
    assertionSetHash: "sha256:assertions",
    requestHash: "sha256:request",
    snapshotId: "snapshot-a",
    snapshotHash: "sha256:snapshot",
    providerModelId: "provider-model-fake-v1",
    priceRateId: "price-rate-fake-v1",
    idempotencyKey: "request-1",
  },
  snapshot: {
    snapshotId: "snapshot-a",
    schemaVersion: 2,
    tenantId: "tenant-a",
    locationId: "location-a",
    tenantName: "Brightsmile Dental",
    locationName: "Downtown Clinic",
    settings: {
      locale: "en-GB",
      toneGuidelines: "Warm and specific.",
      entryMode: "invite",
      requireDisclosure: false,
      requireVerifiedExperience: false,
      maxReviewFormatsPerRequest: 1,
      bannedTerms: ["guaranteed"],
      enabledReviewFormatVersionIds: ["format-a@1"],
      enabledCommands: ["generate"],
      monthlyBudgetMicros: 1_000_000,
      alertThresholdPct: 80,
    },
    provenance: {},
    factOptions: [],
    reviewFormats: [
      {
        id: "format-a@1",
        key: "concise-blurb",
        version: "1.0.0",
        displayName: "Concise blurb",
        targetPlatform: "google",
        locale: "any",
        description: { "en-GB": "One concise paragraph." },
        sample: { "en-GB": "A clear explanation." },
        constraints: {
          minChars: 20,
          maxChars: 350,
          paragraphs: 1,
          emojiPolicy: "none",
          secondPerson: false,
        },
        supportedCommands: ["generate"],
      },
    ],
    promptVersions: [
      {
        hash: "prompt-generate-v1",
        key: "review.generate",
        commandKind: "generate",
        body: "Use only the reviewer-confirmed Assertions.",
        variables: ["locale", "tone"],
      },
    ],
    priceRates: [
      {
        id: "price-rate-fake-v1",
        providerModelId: "provider-model-fake-v1",
        provider: "fake",
        model: "fake-v1",
        inputPerMillionMicros: 0,
        outputPerMillionMicros: 0,
        currency: "EUR",
        unit: "token",
        effectiveFrom: "2026-08-01T00:00:00.000Z",
        effectiveTo: null,
      },
    ],
    providerRouting: {
      version: "routing-v1",
      providerModelId: "provider-model-fake-v1",
      primaryProvider: "fake",
      primaryModel: "fake-v1",
    },
  },
  command: {
    kind: "generate",
    assertionIds: ["assertion-a"],
    rating: 5,
  },
  assertions: [
    {
      id: "assertion-a",
      version: "assertion-a@1",
      reviewSessionId: "session-a",
      semanticId: "service-explained-clearly",
      proposition: "The treatment was explained well.",
      semanticKind: "experience-fact",
      polarity: "positive",
      source: {
        kind: "reviewer-text",
        sourceRevisionId: "source-revision-a",
        start: 0,
        end: 30,
        quotedText: "The treatment was explained well.",
      },
    },
  ],
});

describe("US-03.2 paid-work Attempt preparation", () => {
  it("prepares the exact provider request without entering the provider", async () => {
    let providerCalls = 0;
    const gateway: ModelGatewayPort = {
      generate: async () => {
        providerCalls += 1;
        throw new Error("provider must not run while the request is prepared");
      },
    };

    const prepareAttempt = createPaidWorkAttemptPreparer({ gateway });
    const prepared = await prepareAttempt(workload);

    expect(prepared.requestPayload).toMatchObject({
      model: "fake-v1",
      maxOutputTokens: 350,
      messages: [
        {
          role: "system",
          content: expect.stringContaining("Use only the reviewer-confirmed Assertions."),
        },
        {
          role: "user",
          content:
            "Assertions:\n- [assertion-a] The treatment was explained well.",
        },
      ],
      outputSchema: { name: "CandidateGeneration" },
    });
    expect(providerCalls).toBe(0);
  });

  it("rejects an ungrounded candidate without exposing its bytes", async () => {
    const gateway: ModelGatewayPort = {
      generate: async () => ({
        output: {
          draft: "The clinic gave me a free upgrade.",
          claims: [
            {
              id: "claim-unsupported",
              text: "The clinic gave me a free upgrade.",
              assertionIds: ["assertion-not-supplied"],
            },
          ],
        },
        attempt: {
          provider: "fake",
          model: "fake-v1",
          usage: { inputTokens: 20, outputTokens: 9 },
          receipt: { requestId: "provider-request-a", finishReason: "stop" },
        },
      }),
    };

    const prepared = await createPaidWorkAttemptPreparer({ gateway })(workload);
    const rejected = await prepared.execute("attempt-a").catch((error: unknown) =>
      error,
    );

    expect(rejected).toMatchObject({ code: "GROUNDING_REJECTED" });
    expect(JSON.stringify(rejected)).not.toContain("free upgrade");
  });

  it("rejects grounded wording that violates the resolved policy", async () => {
    const gateway: ModelGatewayPort = {
      generate: async () => ({
        output: {
          draft: "The treatment was guaranteed to be explained well.",
          claims: [
            {
              id: "claim-a",
              text: "The treatment was guaranteed to be explained well.",
              assertionIds: ["assertion-a"],
            },
          ],
        },
        attempt: {
          provider: "fake",
          model: "fake-v1",
          usage: { inputTokens: 20, outputTokens: 9 },
          receipt: { requestId: "provider-request-b", finishReason: "stop" },
        },
      }),
    };

    const prepared = await createPaidWorkAttemptPreparer({ gateway })(workload);
    const rejected = await prepared.execute("attempt-b").catch((error: unknown) =>
      error,
    );

    expect(rejected).toMatchObject({ code: "POLICY_REJECTED" });
    expect(JSON.stringify(rejected)).not.toContain("guaranteed");
  });

  it("does not let a real Assertion id launder an unsupported proposition", async () => {
    const gateway: ModelGatewayPort = {
      generate: async () => ({
        output: {
          draft: "The clinic gave me a free upgrade.",
          claims: [
            {
              id: "claim-laundered",
              text: "The clinic gave me a free upgrade.",
              assertionIds: ["assertion-a"],
            },
          ],
        },
        attempt: {
          provider: "fake",
          model: "fake-v1",
          usage: { inputTokens: 20, outputTokens: 9 },
          receipt: { requestId: "provider-request-c", finishReason: "stop" },
        },
      }),
    };

    const prepared = await createPaidWorkAttemptPreparer({ gateway })(workload);
    const rejected = await prepared.execute("attempt-c").catch((error: unknown) =>
      error,
    );

    expect(rejected).toMatchObject({ code: "GROUNDING_REJECTED" });
    expect(JSON.stringify(rejected)).not.toContain("free upgrade");
  });
});
