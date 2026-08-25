import { describe, expect, it } from "vitest";

import { DraftDtoSchema, GenerationRecordDtoSchema } from "./generation-record.js";

describe("GenerationRecordDtoSchema", () => {
  it("records immutable snapshot, format, prompt, attempt, cost, and lineage identities", () => {
    const record = GenerationRecordDtoSchema.parse({
      id: "generation-a",
      tenantId: "tenant-a",
      locationId: "location-a",
      reviewSessionId: "session-a",
      commandKind: "generate",
      sourceGenerationId: null,
      snapshotId: "snapshot-a",
      promptVersionHash: "prompt-a",
      reviewFormatVersionId: "format-a@1",
      normalizedInput: { assertionIds: ["assertion-a"] },
      candidate: { segments: [], claims: [] },
      groundingVerdict: "pass",
      attempts: [
        {
          id: "attempt-a",
          provider: "anthropic",
          model: "model-a",
          status: "completed",
          startedAt: "2026-08-13T10:00:00Z",
          finishedAt: "2026-08-13T10:00:15Z",
          inputTokens: 100,
          outputTokens: 50,
          priceRateId: "rate-a",
          costMicros: 1_000,
          currency: "EUR",
        },
      ],
      totalCostMicros: 1_000,
      currency: "EUR",
      createdAt: "2026-08-13T10:00:15Z",
    });

    expect(record.attempts[0]?.priceRateId).toBe("rate-a");
  });
});

describe("DraftDtoSchema system annotation provenance", () => {
  it("requires disclosure provenance to be explicitly typed", () => {
    const base = {
      id: "draft-a",
      generationId: "generation-a",
      revision: 1,
      text:
        "The service was attentive.\n\nReview generated with AI assistance on behalf of Tenant A.",
    };

    expect(
      DraftDtoSchema.parse({
        ...base,
        systemAnnotations: [
          {
            kind: "assisted-review-disclosure",
            text: "Review generated with AI assistance on behalf of Tenant A.",
            policyVersionId: "tenant-policy-r7",
          },
        ],
      }).systemAnnotations,
    ).toEqual([
      {
        kind: "assisted-review-disclosure",
        text: "Review generated with AI assistance on behalf of Tenant A.",
        policyVersionId: "tenant-policy-r7",
      },
    ]);
    expect(
      DraftDtoSchema.safeParse({
        ...base,
        systemAnnotations: [
          {
            text: "Review generated with AI assistance on behalf of Tenant A.",
            policyVersionId: "tenant-policy-r7",
          },
        ],
      }).success,
    ).toBe(false);
  });
});
