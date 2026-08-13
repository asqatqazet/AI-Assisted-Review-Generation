import { describe, expect, it } from "vitest";

import { GenerationRecordDtoSchema } from "./generation-record.js";

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
