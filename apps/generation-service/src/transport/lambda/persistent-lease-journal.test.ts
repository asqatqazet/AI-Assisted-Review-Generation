import { GenerationWorkloadDtoSchema } from "@review/contracts/generation";
import type { PostgresGenerationLeaseJournal } from "@review/db/execution-plane";
import type { PostgresGenerationTerminalStore } from "@review/db/execution-plane";
import { describe, expect, it } from "vitest";

import { createPersistentGenerationLeaseJournal } from "./persistent-lease-journal.js";
import { createPersistentGenerationTerminalStore } from "./persistent-terminal-store.js";
import { createPersistentTerminalTailer } from "./persistent-terminal-tailer.js";

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

describe("US-01.3 persistent terminal Generation adapter", () => {
  it("maps only grounded terminal evidence into the execution database", async () => {
    let received: unknown;
    const databaseStore = {
      read: async () => null,
      complete: async (input: unknown) => {
        received = input;
        return {
          draft: {
            id: "draft-a",
            generationId: "generation-a",
            revision: 1 as const,
            text: "The treatment was explained well.",
          },
          actualCostMicros: 0,
        };
      },
      disconnect: async () => undefined,
    } satisfies PostgresGenerationTerminalStore;
    const terminalStore = createPersistentGenerationTerminalStore(databaseStore);

    await expect(
      terminalStore.complete({
        leaseId: "lease-a",
        attemptId: "attempt-a",
        permitJti: "permit-a",
        workload: {
          ...workload,
          snapshot: {
            ...workload.snapshot,
            promptVersions: [
              {
                id: "prompt-a",
                hash: "prompt-generate-v1",
                key: "generate-v1",
                commandKind: "generate",
                body: "Generate grounded JSON.",
                variables: [],
              },
            ],
          },
        },
        result: {
          status: "completed",
          generationId: "generation-a",
          attemptId: "attempt-a",
          draft: "The treatment was explained well.",
          claims: [
            {
              text: "The treatment was explained well.",
              grounding: [
                {
                  kind: "assertion",
                  assertionId: "assertion-a",
                  assertionVersion: "assertion-a@1",
                },
              ],
            },
          ],
          attempt: {
            provider: "fake",
            model: "fake-v1",
            usage: { inputTokens: 12, outputTokens: 7 },
            receipt: { requestId: "fake-request-a" },
          },
        },
      }),
    ).resolves.toMatchObject({ draft: { id: "draft-a" } });

    expect(received).toMatchObject({
      tenantId: "tenant-a",
      locationId: "location-a",
      reviewSessionId: "session-a",
      generationBatchId: "batch-a",
      generationId: "generation-a",
      permitJti: "permit-a",
      snapshotId: "snapshot-a",
      promptVersionId: "prompt-a",
      reviewFormatVersionId: "format-a@1",
      action: "GENERATE",
      leaseId: "lease-a",
      attemptId: "attempt-a",
      result: {
        draft: "The treatment was explained well.",
        claims: [
          {
            proposition: "The treatment was explained well.",
            assertionIds: ["assertion-a"],
          },
        ],
        inputTokens: 12,
        outputTokens: 7,
        providerReceipt: { requestId: "fake-request-a" },
      },
    });
  });
});

describe("US-03.3 persistent terminal replay tailer", () => {
  it("waits for the winning execution and returns only its safe terminal Draft", async () => {
    let reads = 0;
    const waits: number[] = [];
    const tailExisting = createPersistentTerminalTailer({
      databaseStore: {
        read: async () => {
          reads += 1;
          return reads === 1
            ? null
            : {
                draft: {
                  id: "draft-a",
                  generationId: "generation-a",
                  revision: 1,
                  text: "The treatment was explained well.",
                },
                actualCostMicros: 0,
              };
        },
      },
      receiptSigner: {
        signTerminal: async (claims) => {
          expect(claims).toMatchObject({
            permitJti: "permit-a",
            leaseId: "lease-a",
            generationId: "generation-a",
            actualCostMicros: 0,
          });
          return "signed-terminal-receipt";
        },
      },
      wait: async (milliseconds) => {
        waits.push(milliseconds);
      },
      maxPolls: 3,
    });

    await expect(
      tailExisting({
        attemptId: "attempt-a",
        leaseId: "lease-a",
        permitJti: "permit-a",
        workload,
      }),
    ).resolves.toEqual({
      type: "terminal",
      status: "completed",
      terminalReceipt: "signed-terminal-receipt",
      draft: {
        id: "draft-a",
        generationId: "generation-a",
        revision: 1,
        text: "The treatment was explained well.",
      },
    });
    expect(waits).toEqual([100]);
  });
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
