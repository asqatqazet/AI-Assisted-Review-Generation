import { GenerationWorkloadDtoSchema } from "@review/contracts/generation";
import type { PostgresGenerationLeaseJournal } from "@review/db/execution-plane";
import type { PostgresGenerationTerminalStore } from "@review/db/execution-plane";
import { describe, expect, it } from "vitest";

import { createPersistentGenerationLeaseJournal } from "./persistent-lease-journal.js";
import { createPersistentGenerationTerminalStore } from "./persistent-terminal-store.js";
import { createPersistentTerminalTailer } from "./persistent-terminal-tailer.js";

const recoverByScopeMustNotRun = async (): Promise<never> => {
  throw new Error("scope recovery must only run during status reconciliation");
};

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
      minimumFactSelections: 1,
      maximumCustomerAssertionChars: 500,
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

const terminalWorkload = GenerationWorkloadDtoSchema.parse({
  ...workload,
  snapshot: {
    ...workload.snapshot,
    settings: {
      ...workload.snapshot.settings,
      enabledReviewFormatVersionIds: ["format-a@1"],
    },
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
        id: "prompt-a",
        hash: `sha256:${"a".repeat(64)}`,
        key: "generate-v1",
        commandKind: "generate",
        body: "Generate grounded JSON.",
        variables: [],
      },
    ],
  },
});

describe("US-01.3 persistent terminal Generation adapter", () => {
  it("maps immutable workload scope into autonomous checkpoint recovery", async () => {
    let received: unknown;
    const terminalStore = createPersistentGenerationTerminalStore({
      recoverByScope: async (input) => {
        received = input;
        return {
          state: "completed" as const,
          leaseId: "lease-a",
          terminal: {
            rejection: {
              code: "GROUNDING_REJECTED" as const,
              retryable: false,
            },
            actualCostMicros: 0,
          },
        };
      },
      read: async () => {
        throw new Error("scoped recovery is owned by the database store");
      },
      recoveryState: async () => {
        throw new Error("scoped recovery is owned by the database store");
      },
      checkpoint: async () => {
        throw new Error("status recovery must not checkpoint");
      },
      complete: async () => {
        throw new Error("status recovery delegates atomic finalization");
      },
      markIndeterminate: async () => {
        throw new Error("status recovery must not mark state in the adapter");
      },
      reject: async () => {
        throw new Error("status recovery must not reject");
      },
    });

    await expect(
      terminalStore.recoverByScope({
        permitJti: "permit-a",
        workload: terminalWorkload,
      }),
    ).resolves.toMatchObject({
      state: "completed",
      leaseId: "lease-a",
      terminal: { rejection: { code: "GROUNDING_REJECTED" } },
    });
    expect(received).toEqual({
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
    });
  });

  it("maps only grounded terminal evidence into the execution database", async () => {
    const disclosure =
      "Review generated with AI assistance on behalf of Tenant A.";
    const disclosedWorkload = GenerationWorkloadDtoSchema.parse({
      ...terminalWorkload,
      snapshot: {
        ...terminalWorkload.snapshot,
        provenance: {
          requireDisclosure: {
            scope: "tenant",
            sourceId: "tenant-a",
            revision: "tenant-policy-r7",
          },
        },
        settings: {
          ...terminalWorkload.snapshot.settings,
          requireDisclosure: true,
        },
        reviewFormats: [
          {
            ...terminalWorkload.snapshot.reviewFormats[0]!,
            constraints: {
              ...terminalWorkload.snapshot.reviewFormats[0]!.constraints,
              minChars: 0,
              maxChars: 1_000,
              paragraphs: 2,
            },
          },
        ],
      },
    });
    const finalDraft = `The treatment was explained well.\n\n${disclosure}`;
    let receivedCheckpoint: unknown;
    let receivedCompletion: unknown;
    const databaseStore = {
      recoverByScope: recoverByScopeMustNotRun,
      read: async () => null,
      recoveryState: async () => ({ state: "none" as const }),
      checkpoint: async (input: unknown) => {
        receivedCheckpoint = input;
      },
      complete: async (input: unknown) => {
        receivedCompletion = input;
        return {
          draft: {
            id: "draft-a",
            generationId: "generation-a",
            revision: 1 as const,
            text: "The treatment was explained well.",
            systemAnnotations: [
              {
                kind: "assisted-review-disclosure" as const,
                text: disclosure,
                policyVersionId: "tenant-policy-r7",
              },
            ],
          },
          actualCostMicros: 0,
        };
      },
      markIndeterminate: async () => ({ state: "indeterminate" as const }),
      reject: async () => ({ actualCostMicros: 0 }),
      disconnect: async () => undefined,
    } satisfies PostgresGenerationTerminalStore;
    const terminalStore = createPersistentGenerationTerminalStore(databaseStore);

    await expect(
      terminalStore.checkpoint({
        leaseId: "lease-a",
        attemptId: "attempt-a",
        permitJti: "permit-a",
        workload: disclosedWorkload,
        result: {
          status: "completed",
          generationId: "generation-a",
          attemptId: "attempt-a",
          providerOutput: {
            draft: "The treatment was explained well.",
            claims: [{ assertionIds: ["assertion-a"] }],
          },
          draft: finalDraft,
          draftBody: "The treatment was explained well.",
          systemAnnotations: [
            {
              kind: "assisted-review-disclosure",
              text: disclosure,
              policyVersionId: "tenant-policy-r7",
            },
          ],
          claims: [
            {
              id: "claim-a",
              semanticId: "service-explained-clearly",
              semanticKind: "experience-fact",
              polarity: "positive",
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
            receipt: {
              requestId: "fake-request-a",
              finishReason: "stop",
            },
          },
        },
      }),
    ).resolves.toBeUndefined();

    await expect(
      terminalStore.complete({
        leaseId: "lease-a",
        attemptId: "attempt-a",
        permitJti: "permit-a",
        workload: disclosedWorkload,
      }),
    ).resolves.toMatchObject({ draft: { id: "draft-a" } });

    expect(receivedCheckpoint).toMatchObject({
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
        status: "completed",
        draftBody: "The treatment was explained well.",
        providerOutput: {
          draft: "The treatment was explained well.",
          claims: [{ assertionIds: ["assertion-a"] }],
        },
        systemAnnotations: [
          {
            kind: "assisted-review-disclosure",
            text: disclosure,
            policyVersionId: "tenant-policy-r7",
          },
        ],
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
    expect(receivedCompletion).toEqual({
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
    });
  });

  it("reruns terminal Claim and annotation coverage before any Draft bytes reach persistence", async () => {
    let received: unknown;
    const terminalStore = createPersistentGenerationTerminalStore({
      recoverByScope: recoverByScopeMustNotRun,
      checkpoint: async (input: unknown) => {
        received = input;
      },
      complete: async () => ({
        rejection: { code: "POLICY_REJECTED", retryable: false },
        actualCostMicros: 0,
      }),
      read: async () => null,
      recoveryState: async () => ({ state: "none" as const }),
      markIndeterminate: async () => ({ state: "indeterminate" as const }),
      reject: async () => ({ actualCostMicros: 0 }),
    });
    const claim = {
      id: "claim-a",
      semanticId: "service-explained-clearly",
      semanticKind: "experience-fact" as const,
      polarity: "positive" as const,
      text: "The treatment was explained well.",
      grounding: [
        {
          kind: "assertion" as const,
          assertionId: "assertion-a",
          assertionVersion: "assertion-a@1",
        },
      ],
    };
    const injected =
      "The treatment was explained well.\n\nUnproven system-authored wording.";

    await expect(
      terminalStore.checkpoint({
        leaseId: "lease-a",
        attemptId: "attempt-a",
        permitJti: "permit-a",
        workload: terminalWorkload,
        result: {
          status: "completed",
          generationId: "generation-a",
          attemptId: "attempt-a",
          providerOutput: { draft: injected, claims: [] },
          draft: injected,
          draftBody: "The treatment was explained well.",
          systemAnnotations: [],
          claims: [claim],
          attempt: {
            provider: "fake",
            model: "fake-v1",
            usage: { inputTokens: 12, outputTokens: 7 },
            receipt: { requestId: "fake-request-a", finishReason: "stop" },
          },
        },
      }),
    ).resolves.toBeUndefined();

    expect(received).toMatchObject({
      result: {
        status: "rejected",
        code: "POLICY_REJECTED",
        retryable: false,
        providerOutput: { draft: injected },
      },
    });

    await expect(
      terminalStore.complete({
        leaseId: "lease-a",
        attemptId: "attempt-a",
        permitJti: "permit-a",
        workload: terminalWorkload,
      }),
    ).resolves.toEqual({
      rejection: { code: "POLICY_REJECTED", retryable: false },
      actualCostMicros: 0,
    });
  });

  it("does not let a grounded Assertion id launder changed Claim text at the persistence boundary", async () => {
    let received: unknown;
    const terminalStore = createPersistentGenerationTerminalStore({
      recoverByScope: recoverByScopeMustNotRun,
      checkpoint: async (input: unknown) => {
        received = input;
      },
      complete: async () => {
        throw new Error("completion must not run");
      },
      read: async () => null,
      recoveryState: async () => ({ state: "none" as const }),
      markIndeterminate: async () => ({ state: "indeterminate" as const }),
      reject: async () => ({ actualCostMicros: 0 }),
    });
    const laundered = "Parking was free for every visit.";

    await expect(
      terminalStore.checkpoint({
        leaseId: "lease-a",
        attemptId: "attempt-a",
        permitJti: "permit-a",
        workload: terminalWorkload,
        result: {
          status: "completed",
          generationId: "generation-a",
          attemptId: "attempt-a",
          providerOutput: { draft: laundered, claims: [] },
          draft: laundered,
          draftBody: laundered,
          systemAnnotations: [],
          claims: [
            {
              id: "claim-a",
              semanticId: "service-explained-clearly",
              semanticKind: "experience-fact",
              polarity: "positive",
              text: laundered,
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
            receipt: { requestId: "fake-request-a", finishReason: "stop" },
          },
        },
      }),
    ).resolves.toBeUndefined();

    expect(received).toMatchObject({
      result: {
        status: "rejected",
        code: "GROUNDING_REJECTED",
        retryable: false,
        providerOutput: { draft: laundered },
      },
    });
  });

  it("finalizes a durable checkpoint on replay without asking for Provider output again", async () => {
    let completions = 0;
    const terminalStore = createPersistentGenerationTerminalStore({
      recoverByScope: recoverByScopeMustNotRun,
      read: async () => null,
      recoveryState: async () => ({ state: "checkpointed" as const }),
      checkpoint: async () => {
        throw new Error("recovery must use the existing checkpoint");
      },
      complete: async () => {
        completions += 1;
        return {
          draft: {
            id: "draft-a",
            generationId: "generation-a",
            revision: 1 as const,
            text: "The treatment was explained well.",
            systemAnnotations: [],
          },
          actualCostMicros: 0,
        };
      },
      markIndeterminate: async () => ({ state: "indeterminate" as const }),
      reject: async () => ({ actualCostMicros: 0 }),
    });

    await expect(
      terminalStore.recover({
        leaseId: "lease-a",
        attemptId: "attempt-a",
        permitJti: "permit-a",
        workload: terminalWorkload,
      }),
    ).resolves.toEqual({
      state: "completed",
      terminal: {
        draft: {
          id: "draft-a",
          generationId: "generation-a",
          revision: 1,
          text: "The treatment was explained well.",
          systemAnnotations: [],
        },
        actualCostMicros: 0,
      },
    });
    expect(completions).toBe(1);
  });

  it("preserves an uncheckpointed Provider timeout as indeterminate", async () => {
    let marked: unknown;
    const terminalStore = createPersistentGenerationTerminalStore({
      recoverByScope: recoverByScopeMustNotRun,
      read: async () => null,
      recoveryState: async () => ({ state: "indeterminate" as const }),
      checkpoint: async () => undefined,
      complete: async () => {
        throw new Error("an indeterminate Attempt cannot be finalized");
      },
      markIndeterminate: async (input: unknown) => {
        marked = input;
        return { state: "indeterminate" as const };
      },
      reject: async () => ({ actualCostMicros: 0 }),
    });

    await terminalStore.markIndeterminate({
      leaseId: "lease-a",
      attemptId: "attempt-a",
      permitJti: "permit-a",
      workload: terminalWorkload,
      reason: "provider-timeout",
    });
    expect(marked).toMatchObject({
      attemptId: "attempt-a",
      code: "PROVIDER_RESULT_INDETERMINATE",
    });
    await expect(
      terminalStore.recover({
        leaseId: "lease-a",
        attemptId: "attempt-a",
        permitJti: "permit-a",
        workload: terminalWorkload,
      }),
    ).resolves.toEqual({ state: "indeterminate" });
  });
});

describe("US-03.3 persistent terminal replay tailer", () => {
  it("recovers a winner's checkpoint and returns only its safe terminal Draft", async () => {
    let recoveries = 0;
    const waits: number[] = [];
    const tailExisting = createPersistentTerminalTailer({
      terminalStore: {
        recover: async () => {
          recoveries += 1;
          return recoveries === 1
            ? ({ state: "none" } as const)
            : {
                state: "completed" as const,
                terminal: {
                  draft: {
                    id: "draft-a",
                    generationId: "generation-a",
                    revision: 1 as const,
                    text: "The treatment was explained well.",
                    systemAnnotations: [],
                  },
                  actualCostMicros: 0,
                },
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
        systemAnnotations: [],
      },
    });
    expect(waits).toEqual([100]);
  });

  it("replays a persisted rejection without calling the provider again", async () => {
    const tailExisting = createPersistentTerminalTailer({
      terminalStore: {
        recover: async () => ({
          state: "completed" as const,
          terminal: {
            rejection: {
              code: "PROVIDER_UNAVAILABLE" as const,
              retryable: true,
            },
            actualCostMicros: 0,
          },
        }),
      },
      receiptSigner: {
        signTerminal: async (claims) => {
          expect(claims).toMatchObject({
            outcome: "rejected",
            actualCostMicros: 0,
          });
          return "signed-rejected-terminal";
        },
      },
      wait: async () => {
        throw new Error("a persisted rejection must return immediately");
      },
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
      status: "rejected",
      terminalReceipt: "signed-rejected-terminal",
      code: "PROVIDER_UNAVAILABLE",
      retryable: true,
    });
  });

  it("stops tailing as soon as a crashed execution is explicitly indeterminate", async () => {
    let waits = 0;
    const tailExisting = createPersistentTerminalTailer({
      terminalStore: {
        recover: async () => ({ state: "indeterminate" as const }),
      },
      receiptSigner: {
        signTerminal: async () => {
          throw new Error("indeterminate work has no terminal receipt");
        },
      },
      wait: async () => {
        waits += 1;
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
    ).rejects.toThrow("PROVIDER_RESULT_INDETERMINATE");
    expect(waits).toBe(0);
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
