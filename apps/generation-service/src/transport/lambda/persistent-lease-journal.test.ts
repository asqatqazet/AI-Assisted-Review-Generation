import { GenerationWorkloadDtoSchema } from "@review/contracts/generation";
import type { PostgresGenerationLeaseJournal } from "@review/db/execution-plane";
import { describe, expect, it } from "vitest";

import { createPersistentGenerationLeaseJournal } from "./persistent-lease-journal.js";

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
    providerModelId: "provider-model-a",
    priceRateId: "price-rate-a",
    idempotencyKey: "request-a",
  },
  snapshot: {
    snapshotId: "snapshot-a",
    schemaVersion: 2,
    tenantId: "tenant-a",
    locationId: "location-a",
    tenantName: "Tenant A",
    locationName: "Location A",
    provenance: {},
    settings: {
      locale: "en-GB",
      toneGuidelines: "Warm and specific.",
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
    factOptions: [],
    reviewFormats: [],
    promptVersions: [],
    priceRates: [
      {
        id: "price-rate-a",
        providerModelId: "provider-model-a",
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
      providerModelId: "provider-model-a",
      primaryProvider: "fake",
      primaryModel: "fake-v1",
    },
  },
  command: { kind: "generate", assertionIds: ["assertion-a"], rating: 5 },
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

describe("US-03.2 persistent Generation lease journal adapter", () => {
  it("maps the signed workload and prepared provider request into the DB fence", async () => {
    let prepareInput: unknown;
    let claimInput: unknown;
    const databaseJournal = {
      prepare: async (input: unknown) => {
        prepareInput = input;
        return {
          status: "leased" as const,
          leaseId: "lease-a",
          leaseExpiresAt: "2026-08-17T12:00:45.000Z",
        };
      },
      claimExecution: async (input: unknown) => {
        claimInput = input;
        return { status: "claimed" as const, attemptId: "attempt-a" };
      },
      status: async () => ({ state: "leased" as const }),
      cancelExpired: async () => ({ state: "cancelled" as const }),
      disconnect: async () => undefined,
    } satisfies PostgresGenerationLeaseJournal;
    const journal = createPersistentGenerationLeaseJournal(databaseJournal);

    await expect(
      journal.prepare({
        permitJti: "permit-a",
        permitExpiresAt: "2026-08-17T12:01:00.000Z",
        workload,
      }),
    ).resolves.toMatchObject({ status: "leased", leaseId: "lease-a" });
    await expect(
      journal.claimExecution({
        leaseId: "lease-a",
        permitJti: "permit-a",
        activationExpiresAt: "2026-08-17T12:00:40.000Z",
        attemptOrdinal: 1,
        requestPayload: { model: "fake-v1", messages: [] },
        workload,
      }),
    ).resolves.toEqual({ status: "claimed", attemptId: "attempt-a" });

    expect(prepareInput).toEqual({
      tenantId: "tenant-a",
      locationId: "location-a",
      reviewSessionId: "session-a",
      generationBatchId: "batch-a",
      generationId: "generation-a",
      permitJti: "permit-a",
      permitExpiresAt: "2026-08-17T12:01:00.000Z",
    });
    expect(claimInput).toEqual({
      tenantId: "tenant-a",
      locationId: "location-a",
      reviewSessionId: "session-a",
      generationBatchId: "batch-a",
      generationId: "generation-a",
      permitJti: "permit-a",
      leaseId: "lease-a",
      activationExpiresAt: "2026-08-17T12:00:40.000Z",
      attemptOrdinal: 1,
      providerModelId: "provider-model-a",
      priceRateId: "price-rate-a",
      requestPayload: { model: "fake-v1", messages: [] },
    });
  });
});
