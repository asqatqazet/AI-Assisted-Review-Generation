import { describe, expect, it } from "vitest";

import { createPaidWorkGenerationHandler } from "./paid-work-handler.js";

const workload = {
  bindings: {
    tenantId: "tenant-a",
    locationId: "location-a",
    reviewSessionId: "session-a",
    generationBatchId: "batch-a",
    generationId: "generation-a",
    action: "generate" as const,
    reviewFormatVersionId: "format-a@1",
    assertionSetHash: "sha256:assertions",
    requestHash: "sha256:request",
    snapshotId: "snap-01",
    snapshotHash: "sha256:snapshot",
    providerModelId: "provider-model-fake-v1",
    priceRateId: "price-rate-fake-v1",
    idempotencyKey: "request-1",
  },
  snapshot: {
    snapshotId: "snap-01",
    schemaVersion: 2,
    tenantId: "tenant-a",
    locationId: "location-a",
    tenantName: "Brightsmile Dental",
    locationName: "Downtown Clinic",
    provenance: {
      locale: { scope: "tenant" as const, sourceId: "tenant-a", revision: "r1" },
    },
    settings: {
      locale: "en-GB" as const,
      toneGuidelines: "Warm and specific.",
      entryMode: "invite" as const,
      requireDisclosure: false,
      requireVerifiedExperience: false,
      maxReviewFormatsPerRequest: 1,
      minimumFactSelections: 1,
      maximumCustomerAssertionChars: 500,
      bannedTerms: [],
      enabledReviewFormatVersionIds: [],
      enabledCommands: ["generate" as const],
      monthlyBudgetMicros: 1_000_000,
      alertThresholdPct: 80,
    },
    factOptions: [],
    reviewFormats: [],
    promptVersions: [],
    priceRates: [
      {
        id: "price-rate-fake-v1",
        providerModelId: "provider-model-fake-v1",
        provider: "fake",
        model: "fake-v1",
        inputPerMillionMicros: 0,
        outputPerMillionMicros: 0,
        currency: "EUR",
        unit: "token" as const,
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
    kind: "generate" as const,
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
      semanticKind: "experience-fact" as const,
      polarity: "positive" as const,
      source: {
        kind: "reviewer-text" as const,
        sourceRevisionId: "source-revision-a",
        start: 0,
        end: 30,
        quotedText: "The treatment was explained well.",
      },
    },
  ],
};

const recoverByScopeMustNotRun = async (): Promise<never> => {
  throw new Error("scope recovery must only run during status reconciliation");
};

describe("US-03.2 paid-work Generation handler", () => {
  it("prepares and signs one finite lease without entering execution", async () => {
    let executionCalls = 0;
    let journalInput: unknown;
    const handler = createPaidWorkGenerationHandler({
      permitVerifier: {
        verify: async (permit, receivedWorkload) => {
          expect(permit).toBe("signed-context-permit");
          expect(receivedWorkload).toEqual(workload);
          return {
            permitJti: "permit-jti-a",
            expiresAt: "2026-08-17T12:01:00.000Z",
          };
        },
      },
      activationVerifier: {
        verify: async () => {
          throw new Error("activation verification must not run during prepare");
        },
      },
      leaseJournal: {
        prepare: async (input) => {
          journalInput = input;
          return {
            status: "leased",
            leaseId: "lease-a",
            leaseExpiresAt: "2026-08-17T12:00:45.000Z",
          };
        },
        claimExecution: async () => {
          throw new Error("Attempt claiming must not run during prepare");
        },
        status: async () => {
          throw new Error("status must not run during prepare");
        },
        cancelExpired: async () => {
          throw new Error("cancellation must not run during prepare");
        },
      },
      receiptSigner: {
        signLease: async (claims) => {
          expect(claims).toMatchObject({
            permitJti: "permit-jti-a",
            leaseId: "lease-a",
            generationId: "generation-a",
          });
          return "signed-generation-lease-receipt";
        },
        signStatus: async () => {
          throw new Error("status signing must not run during prepare");
        },
        signTerminal: async () => {
          throw new Error("terminal signing must not run during prepare");
        },
      },
      terminalStore: {
        recoverByScope: recoverByScopeMustNotRun,
        checkpoint: async () => {
          throw new Error("terminal checkpoint must not run during prepare");
        },
        complete: async () => {
          throw new Error("terminal persistence must not run during prepare");
        },
        recover: async () => {
          throw new Error("terminal recovery must not run during prepare");
        },
        markIndeterminate: async () => {
          throw new Error("indeterminate state must not run during prepare");
        },
        reject: async () => {
          throw new Error("terminal rejection must not run during prepare");
        },
      },
      prepareAttempt: async () => ({
        requestPayload: {},
        execute: async () => {
          executionCalls += 1;
          throw new Error("execution must not run during prepare");
        },
      }),
      tailExisting: async () => {
        throw new Error("tailing must not run during prepare");
      },
    });

    await expect(
      handler({
        operation: "prepare",
        permit: "signed-context-permit",
        workload,
      }),
    ).resolves.toEqual({
      operation: "prepare",
      status: "leased",
      leaseId: "lease-a",
      leaseExpiresAt: "2026-08-17T12:00:45.000Z",
      leaseReceipt: "signed-generation-lease-receipt",
    });

    expect(journalInput).toMatchObject({
      permitJti: "permit-jti-a",
      permitExpiresAt: "2026-08-17T12:01:00.000Z",
      workload,
    });
    expect(executionCalls).toBe(0);
  });

  it("claims Attempt 1 atomically before entering provider execution", async () => {
    const events: string[] = [];
    const handler = createPaidWorkGenerationHandler({
      permitVerifier: {
        verify: async () => ({
          permitJti: "permit-jti-a",
          expiresAt: "2026-08-17T12:01:00.000Z",
        }),
      },
      activationVerifier: {
        verify: async (activation, leaseId, receivedWorkload) => {
          events.push("activation-verified");
          expect(activation).toBe("signed-context-activation");
          expect(leaseId).toBe("lease-a");
          expect(receivedWorkload).toEqual(workload);
          return {
            expiresAt: "2026-08-17T12:00:40.000Z",
            permitJti: "permit-jti-a",
          };
        },
      },
      leaseJournal: {
        prepare: async () => {
          throw new Error("prepare must not run during execute");
        },
        claimExecution: async (input) => {
          events.push("attempt-claimed");
          expect(input).toMatchObject({
            leaseId: "lease-a",
            permitJti: "permit-jti-a",
            attemptOrdinal: 1,
            activationExpiresAt: "2026-08-17T12:00:40.000Z",
            requestPayload: {
              model: "fake-v1",
              messages: [{ role: "user", content: "bound provider request" }],
            },
            workload,
          });
          return { status: "claimed", attemptId: "attempt-a" };
        },
        status: async () => {
          throw new Error("status must not run during execute");
        },
        cancelExpired: async () => {
          throw new Error("cancellation must not run during execute");
        },
      },
      receiptSigner: {
        signLease: async () => {
          throw new Error("lease signing must not run during execute");
        },
        signStatus: async () => {
          throw new Error("status signing must not run during execute");
        },
        signTerminal: async (claims) => {
          events.push("terminal-signed");
          expect(claims).toMatchObject({
            leaseId: "lease-a",
            generationId: "generation-a",
            outcome: "completed",
            actualCostMicros: 0,
          });
          return "signed-terminal-receipt";
        },
      },
      terminalStore: {
        recoverByScope: recoverByScopeMustNotRun,
        checkpoint: async (input) => {
          events.push("terminal-checkpointed");
          expect(input).toMatchObject({
            leaseId: "lease-a",
            attemptId: "attempt-a",
            workload,
            result: {
              status: "completed",
              generationId: "generation-a",
              providerOutput: { claims: [] },
              draft: "The treatment was explained well.",
              draftBody: "The treatment was explained well.",
              systemAnnotations: [],
            },
          });
        },
        complete: async (input) => {
          events.push("terminal-persisted");
          expect(input).toMatchObject({
            leaseId: "lease-a",
            attemptId: "attempt-a",
            workload,
          });
          return {
            draft: {
              id: "draft-a",
              generationId: "generation-a",
              revision: 1,
              text: "The treatment was explained well.",
              systemAnnotations: [],
            },
            actualCostMicros: 0,
          };
        },
        recover: async () => ({ state: "none" }),
        markIndeterminate: async () => {
          throw new Error("successful work must not be indeterminate");
        },
        reject: async () => {
          throw new Error("successful work must not persist a rejection");
        },
      },
      prepareAttempt: async (receivedWorkload) => {
        events.push("attempt-prepared");
        expect(receivedWorkload).toEqual(workload);
        return {
          requestPayload: {
            model: "fake-v1",
            messages: [{ role: "user", content: "bound provider request" }],
          },
          execute: async (attemptId: string) => {
            events.push("provider-entered");
            expect(attemptId).toBe("attempt-a");
            return {
              status: "completed",
              generationId: "generation-a",
              attemptId,
              providerOutput: { claims: [] },
              draft: "The treatment was explained well.",
              draftBody: "The treatment was explained well.",
              systemAnnotations: [],
              claims: [],
              attempt: {
                provider: "fake",
                model: "fake-v1",
                usage: { inputTokens: 12, outputTokens: 7 },
                receipt: {
                  requestId: "fake-request-a",
                  finishReason: "stop",
                },
              },
            };
          },
        };
      },
      tailExisting: async () => {
        throw new Error("a winning execution must not tail");
      },
    });

    await expect(
      handler({
        operation: "execute",
        leaseId: "lease-a",
        activation: "signed-context-activation",
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
    expect(events).toEqual([
      "activation-verified",
      "attempt-prepared",
      "attempt-claimed",
      "provider-entered",
      "terminal-checkpointed",
      "terminal-persisted",
      "terminal-signed",
    ]);
  });

  it("tails the winner and never enters the provider on replay", async () => {
    let providerCalls = 0;
    const handler = createPaidWorkGenerationHandler({
      permitVerifier: {
        verify: async () => {
          throw new Error("permit verification is prepare-only");
        },
      },
      activationVerifier: {
        verify: async () => ({
          expiresAt: "2026-08-17T12:00:40.000Z",
          permitJti: "permit-jti-a",
        }),
      },
      leaseJournal: {
        prepare: async () => {
          throw new Error("prepare must not run during execute");
        },
        claimExecution: async () => ({
          status: "existing",
          attemptId: "attempt-a",
        }),
        status: async () => {
          throw new Error("status must not run during execute");
        },
        cancelExpired: async () => {
          throw new Error("cancellation must not run during execute");
        },
      },
      receiptSigner: {
        signLease: async () => {
          throw new Error("lease signing must not run during execute");
        },
        signStatus: async () => {
          throw new Error("status signing must not run during execute");
        },
        signTerminal: async () => {
          throw new Error("replayed execution must not sign another terminal");
        },
      },
      terminalStore: {
        recoverByScope: recoverByScopeMustNotRun,
        checkpoint: async () => {
          throw new Error("replayed execution must not checkpoint another result");
        },
        complete: async () => {
          throw new Error("replayed execution must not persist another terminal");
        },
        recover: async () => ({ state: "none" }),
        markIndeterminate: async () => {
          throw new Error("replay must not change indeterminate state");
        },
        reject: async () => {
          throw new Error("replayed execution must not persist another rejection");
        },
      },
      prepareAttempt: async () => ({
        requestPayload: {},
        execute: async () => {
          providerCalls += 1;
          throw new Error("replay must not enter provider execution");
        },
      }),
      tailExisting: async (input) => {
        expect(input).toEqual({
          attemptId: "attempt-a",
          leaseId: "lease-a",
          permitJti: "permit-jti-a",
          workload,
        });
        return { status: "completed", generationId: "generation-a" };
      },
    });

    await expect(
      handler({
        operation: "execute",
        leaseId: "lease-a",
        activation: "signed-context-activation",
        workload,
      }),
    ).resolves.toEqual({ status: "completed", generationId: "generation-a" });
    expect(providerCalls).toBe(0);
  });

  it("persists and signs a rejected terminal without releasing a Draft", async () => {
    const operations: string[] = [];
    const handler = createPaidWorkGenerationHandler({
      permitVerifier: {
        verify: async () => {
          throw new Error("permit verification is prepare-only");
        },
      },
      activationVerifier: {
        verify: async () => ({
          expiresAt: "2026-08-17T12:00:40.000Z",
          permitJti: "permit-jti-a",
        }),
      },
      leaseJournal: {
        prepare: async () => {
          throw new Error("prepare must not run during execute");
        },
        claimExecution: async () => ({
          status: "claimed",
          attemptId: "attempt-a",
        }),
        status: async () => {
          throw new Error("status must not run during execute");
        },
        cancelExpired: async () => {
          throw new Error("cancellation must not run during execute");
        },
      },
      receiptSigner: {
        signLease: async () => {
          throw new Error("lease signing must not run during execute");
        },
        signStatus: async () => {
          throw new Error("status signing must not run during execute");
        },
        signTerminal: async (claims) => {
          operations.push("rejection-signed");
          expect(claims).toMatchObject({
            outcome: "rejected",
            actualCostMicros: 0,
            leaseId: "lease-a",
          });
          return "signed-rejected-terminal";
        },
      },
      terminalStore: {
        recoverByScope: recoverByScopeMustNotRun,
        checkpoint: async () => {
          throw new Error("a rejected Generation has no result checkpoint");
        },
        complete: async () => {
          throw new Error("a rejected Generation must not persist a Draft");
        },
        recover: async () => ({ state: "none" }),
        markIndeterminate: async () => {
          throw new Error("ordinary provider failure is terminally rejected");
        },
        reject: async (input) => {
          operations.push("rejection-persisted");
          expect(input).toMatchObject({
            leaseId: "lease-a",
            attemptId: "attempt-a",
            code: "PROVIDER_UNAVAILABLE",
            retryable: true,
          });
          return { actualCostMicros: 0 };
        },
      },
      prepareAttempt: async () => ({
        requestPayload: { model: "fake-v1" },
        execute: async () => {
          throw new Error("provider unavailable");
        },
      }),
      tailExisting: async () => {
        throw new Error("a winning rejection must not tail");
      },
    });

    await expect(
      handler({
        operation: "execute",
        leaseId: "lease-a",
        activation: "signed-context-activation",
        workload,
      }),
    ).resolves.toEqual({
      type: "terminal",
      status: "rejected",
      terminalReceipt: "signed-rejected-terminal",
      code: "PROVIDER_UNAVAILABLE",
      retryable: true,
    });
    expect(operations).toEqual(["rejection-persisted", "rejection-signed"]);
  });

  it("checkpoints one Provider result and retries terminalization without another Provider call", async () => {
    const operations: string[] = [];
    let providerCalls = 0;
    let completionCalls = 0;
    const terminalStore = {
      recoverByScope: recoverByScopeMustNotRun,
      checkpoint: async (input: unknown) => {
        operations.push("checkpointed");
        expect(input).toMatchObject({
          attemptId: "attempt-a",
          result: {
            providerOutput: {
              claims: [{ text: "The treatment was explained well." }],
            },
          },
        });
      },
      recover: async () => ({ state: "none" as const }),
      markIndeterminate: async () => ({ state: "indeterminate" as const }),
      complete: async () => {
        completionCalls += 1;
        operations.push(`complete-${completionCalls}`);
        if (completionCalls === 1) {
          throw new Error("injected first terminalization failure");
        }
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
      reject: async () => {
        throw new Error("a checkpointed success must not become a rejection");
      },
    };
    const handler = createPaidWorkGenerationHandler({
      permitVerifier: {
        verify: async () => {
          throw new Error("permit verification is prepare-only");
        },
      },
      activationVerifier: {
        verify: async () => ({
          expiresAt: "2026-08-17T12:00:40.000Z",
          permitJti: "permit-jti-a",
        }),
      },
      leaseJournal: {
        prepare: async () => {
          throw new Error("prepare must not run during execute");
        },
        claimExecution: async () => ({
          status: "claimed",
          attemptId: "attempt-a",
        }),
        status: async () => {
          throw new Error("status must not run during execute");
        },
        cancelExpired: async () => {
          throw new Error("cancellation must not run during execute");
        },
      },
      receiptSigner: {
        signLease: async () => {
          throw new Error("lease signing must not run during execute");
        },
        signStatus: async () => {
          throw new Error("status signing must not run during execute");
        },
        signTerminal: async () => "signed-terminal-receipt",
      },
      terminalStore,
      prepareAttempt: async () => ({
        requestPayload: { model: "fake-v1" },
        execute: async (attemptId) => {
          providerCalls += 1;
          operations.push("provider");
          return {
            status: "completed",
            generationId: "generation-a",
            attemptId,
            providerOutput: {
              claims: [{ text: "The treatment was explained well." }],
            },
            draft: "The treatment was explained well.",
            draftBody: "The treatment was explained well.",
            systemAnnotations: [],
            claims: [],
            attempt: {
              provider: "fake",
              model: "fake-v1",
              usage: { inputTokens: 12, outputTokens: 7 },
              receipt: { requestId: "fake-a", finishReason: "stop" },
            },
          };
        },
      }),
      tailExisting: async () => {
        throw new Error("the winning execution must not tail");
      },
    });

    await expect(
      handler({
        operation: "execute",
        leaseId: "lease-a",
        activation: "signed-context-activation",
        workload,
      }),
    ).resolves.toMatchObject({
      type: "terminal",
      status: "completed",
      draft: { text: "The treatment was explained well." },
    });
    expect(providerCalls).toBe(1);
    expect(operations).toEqual([
      "provider",
      "checkpointed",
      "complete-1",
      "complete-2",
    ]);
  });

  it("makes two failed checkpoint writes indeterminate and never repeats paid Provider I/O", async () => {
    let claims = 0;
    let providerCalls = 0;
    let checkpointCalls = 0;
    let indeterminateMarks = 0;
    let indeterminate = false;
    const handler = createPaidWorkGenerationHandler({
      permitVerifier: {
        verify: async () => {
          throw new Error("permit verification is prepare-only");
        },
      },
      activationVerifier: {
        verify: async () => ({
          expiresAt: "2026-08-17T12:00:40.000Z",
          permitJti: "permit-jti-a",
        }),
      },
      leaseJournal: {
        prepare: async () => {
          throw new Error("prepare must not run during execute");
        },
        claimExecution: async () => {
          claims += 1;
          return {
            status: claims === 1 ? ("claimed" as const) : ("existing" as const),
            attemptId: "attempt-a",
          };
        },
        status: async () => {
          throw new Error("status must not run during execute");
        },
        cancelExpired: async () => {
          throw new Error("cancellation must not run during execute");
        },
      },
      receiptSigner: {
        signLease: async () => "unused",
        signStatus: async () => "unused",
        signTerminal: async () => {
          throw new Error("indeterminate work has no terminal receipt");
        },
      },
      terminalStore: {
        recoverByScope: recoverByScopeMustNotRun,
        checkpoint: async () => {
          checkpointCalls += 1;
          throw new Error("injected checkpoint transport failure");
        },
        complete: async () => {
          throw new Error("an uncheckpointed result cannot complete");
        },
        recover: async () =>
          indeterminate
            ? ({ state: "indeterminate" } as const)
            : ({ state: "none" } as const),
        markIndeterminate: async (input) => {
          expect(input).toMatchObject({
            attemptId: "attempt-a",
            reason: "checkpoint-unavailable",
          });
          indeterminateMarks += 1;
          indeterminate = true;
          return { state: "indeterminate" as const };
        },
        reject: async () => {
          throw new Error("a returned Provider result must not become unavailable");
        },
      },
      prepareAttempt: async () => ({
        requestPayload: { model: "fake-v1" },
        execute: async (attemptId) => {
          providerCalls += 1;
          return {
            status: "completed" as const,
            generationId: "generation-a",
            attemptId,
            providerOutput: {
              claims: [{ text: "The treatment was explained well." }],
            },
            draft: "The treatment was explained well.",
            draftBody: "The treatment was explained well.",
            systemAnnotations: [],
            claims: [],
            attempt: {
              provider: "fake",
              model: "fake-v1",
              usage: { inputTokens: 12, outputTokens: 7 },
              receipt: { requestId: "fake-a", finishReason: "stop" },
            },
          };
        },
      }),
      tailExisting: async () => {
        throw new Error("an indeterminate Attempt must not tail");
      },
    });
    const invocation = {
      operation: "execute" as const,
      leaseId: "lease-a",
      activation: "signed-context-activation",
      workload,
    };

    await expect(handler(invocation)).rejects.toThrow(
      "PROVIDER_RESULT_INDETERMINATE",
    );
    await expect(handler(invocation)).rejects.toThrow(
      "PROVIDER_RESULT_INDETERMINATE",
    );
    expect(providerCalls).toBe(1);
    expect(checkpointCalls).toBe(2);
    expect(indeterminateMarks).toBe(1);
  });

  it("recovers when both checkpoint acknowledgements are lost after the checkpoint commits", async () => {
    let providerCalls = 0;
    let checkpointCalls = 0;
    let checkpointCommitted = false;
    let indeterminateMarks = 0;
    const terminal = {
      draft: {
        id: "draft-a",
        generationId: "generation-a",
        revision: 1 as const,
        text: "The treatment was explained well.",
        systemAnnotations: [],
      },
      actualCostMicros: 0,
    };
    const handler = createPaidWorkGenerationHandler({
      permitVerifier: {
        verify: async () => {
          throw new Error("permit verification is prepare-only");
        },
      },
      activationVerifier: {
        verify: async () => ({
          expiresAt: "2026-08-17T12:00:40.000Z",
          permitJti: "permit-jti-a",
        }),
      },
      leaseJournal: {
        prepare: async () => {
          throw new Error("prepare must not run during execute");
        },
        claimExecution: async () => ({
          status: "claimed" as const,
          attemptId: "attempt-a",
        }),
        status: async () => {
          throw new Error("status must not run during execute");
        },
        cancelExpired: async () => {
          throw new Error("cancellation must not run during execute");
        },
      },
      receiptSigner: {
        signLease: async () => "unused",
        signStatus: async () => "unused",
        signTerminal: async () => "signed-recovered-terminal",
      },
      terminalStore: {
        recoverByScope: recoverByScopeMustNotRun,
        checkpoint: async () => {
          checkpointCalls += 1;
          checkpointCommitted = true;
          throw new Error("checkpoint response lost");
        },
        recover: async () =>
          checkpointCommitted
            ? ({ state: "completed" as const, terminal })
            : ({ state: "none" as const }),
        markIndeterminate: async () => {
          indeterminateMarks += 1;
          return { state: "indeterminate" as const };
        },
        complete: async () => {
          throw new Error("recover owns checkpoint finalization");
        },
        reject: async () => {
          throw new Error("a returned Provider result must not be rejected");
        },
      },
      prepareAttempt: async () => ({
        requestPayload: { model: "fake-v1" },
        execute: async (attemptId) => {
          providerCalls += 1;
          return {
            status: "completed" as const,
            generationId: "generation-a",
            attemptId,
            providerOutput: {
              claims: [{ text: "The treatment was explained well." }],
            },
            draft: "The treatment was explained well.",
            draftBody: "The treatment was explained well.",
            systemAnnotations: [],
            claims: [],
            attempt: {
              provider: "fake",
              model: "fake-v1",
              usage: { inputTokens: 12, outputTokens: 7 },
              receipt: { requestId: "fake-a", finishReason: "stop" },
            },
          };
        },
      }),
      tailExisting: async () => {
        throw new Error("the winning execution must not tail");
      },
    });

    await expect(
      handler({
        operation: "execute",
        leaseId: "lease-a",
        activation: "signed-context-activation",
        workload,
      }),
    ).resolves.toMatchObject({
      type: "terminal",
      status: "completed",
      terminalReceipt: "signed-recovered-terminal",
    });
    expect(providerCalls).toBe(1);
    expect(checkpointCalls).toBe(2);
    expect(indeterminateMarks).toBe(0);
  });

  it.each(["checkpointed", "terminal"] as const)(
    "finalizes when the %s state wins the mark-indeterminate CAS",
    async (markState) => {
      let providerCalls = 0;
      let checkpointCalls = 0;
      let recoveryCalls = 0;
      let indeterminateMarks = 0;
      const terminal = {
        draft: {
          id: "draft-a",
          generationId: "generation-a",
          revision: 1 as const,
          text: "The treatment was explained well.",
          systemAnnotations: [],
        },
        actualCostMicros: 0,
      };
      const handler = createPaidWorkGenerationHandler({
        permitVerifier: {
          verify: async () => {
            throw new Error("permit verification is prepare-only");
          },
        },
        activationVerifier: {
          verify: async () => ({
            expiresAt: "2026-08-17T12:00:40.000Z",
            permitJti: "permit-jti-a",
          }),
        },
        leaseJournal: {
          prepare: async () => {
            throw new Error("prepare must not run during execute");
          },
          claimExecution: async () => ({
            status: "claimed" as const,
            attemptId: "attempt-a",
          }),
          status: async () => {
            throw new Error("status must not run during execute");
          },
          cancelExpired: async () => {
            throw new Error("cancellation must not run during execute");
          },
        },
        receiptSigner: {
          signLease: async () => "unused",
          signStatus: async () => "unused",
          signTerminal: async () => "signed-race-terminal",
        },
        terminalStore: {
          recoverByScope: recoverByScopeMustNotRun,
          checkpoint: async () => {
            checkpointCalls += 1;
            throw new Error("checkpoint transport unavailable");
          },
          recover: async () => {
            recoveryCalls += 1;
            return recoveryCalls === 1
              ? ({ state: "none" as const })
              : ({ state: "completed" as const, terminal });
          },
          markIndeterminate: async () => {
            indeterminateMarks += 1;
            return { state: markState };
          },
          complete: async () => {
            throw new Error("recover owns race finalization");
          },
          reject: async () => {
            throw new Error("a returned Provider result must not be rejected");
          },
        },
        prepareAttempt: async () => ({
          requestPayload: { model: "fake-v1" },
          execute: async (attemptId) => {
            providerCalls += 1;
            return {
              status: "completed" as const,
              generationId: "generation-a",
              attemptId,
              providerOutput: {
                claims: [{ text: "The treatment was explained well." }],
              },
              draft: "The treatment was explained well.",
              draftBody: "The treatment was explained well.",
              systemAnnotations: [],
              claims: [],
              attempt: {
                provider: "fake",
                model: "fake-v1",
                usage: { inputTokens: 12, outputTokens: 7 },
                receipt: { requestId: "fake-a", finishReason: "stop" },
              },
            };
          },
        }),
        tailExisting: async () => {
          throw new Error("the winning execution must not tail");
        },
      });

      await expect(
        handler({
          operation: "execute",
          leaseId: "lease-a",
          activation: "signed-context-activation",
          workload,
        }),
      ).resolves.toMatchObject({
        type: "terminal",
        status: "completed",
        terminalReceipt: "signed-race-terminal",
      });
      expect(providerCalls).toBe(1);
      expect(checkpointCalls).toBe(2);
      expect(indeterminateMarks).toBe(1);
      expect(recoveryCalls).toBe(2);
    },
  );

  it("checkpoints a grounding-rejected Provider output and replays only its safe terminal", async () => {
    const rawSecret = "unsupported-private-provider-wording";
    let claims = 0;
    let providerCalls = 0;
    let checkpointed: unknown;
    const rejectedTerminal = {
      rejection: {
        code: "GROUNDING_REJECTED" as const,
        retryable: false,
      },
      actualCostMicros: 0,
    };
    const handler = createPaidWorkGenerationHandler({
      permitVerifier: {
        verify: async () => {
          throw new Error("permit verification is prepare-only");
        },
      },
      activationVerifier: {
        verify: async () => ({
          expiresAt: "2026-08-17T12:00:40.000Z",
          permitJti: "permit-jti-a",
        }),
      },
      leaseJournal: {
        prepare: async () => {
          throw new Error("prepare must not run during execute");
        },
        claimExecution: async () => {
          claims += 1;
          return {
            status: claims === 1 ? "claimed" : "existing",
            attemptId: "attempt-a",
          };
        },
        status: async () => {
          throw new Error("status must not run during execute");
        },
        cancelExpired: async () => {
          throw new Error("cancellation must not run during execute");
        },
      },
      receiptSigner: {
        signLease: async () => "unused",
        signStatus: async () => "unused",
        signTerminal: async () => "signed-rejected-terminal",
      },
      terminalStore: {
        recoverByScope: recoverByScopeMustNotRun,
        checkpoint: async (input) => {
          checkpointed = input;
        },
        complete: async () => rejectedTerminal,
        recover: async () => ({
          state: "completed" as const,
          terminal: rejectedTerminal,
        }),
        markIndeterminate: async () => ({ state: "indeterminate" as const }),
        reject: async () => {
          throw new Error("Provider-returned rejection uses its checkpoint");
        },
      },
      prepareAttempt: async () => ({
        requestPayload: { model: "fake-v1" },
        execute: async (attemptId) => {
          providerCalls += 1;
          return {
            status: "rejected" as const,
            code: "GROUNDING_REJECTED" as const,
            generationId: "generation-a",
            attemptId,
            providerOutput: { draft: rawSecret, claims: [] },
            attempt: {
              provider: "fake",
              model: "fake-v1",
              usage: { inputTokens: 13, outputTokens: 4 },
              receipt: { requestId: "provider-rejected-a", finishReason: "stop" },
            },
          };
        },
      }),
      tailExisting: async () => {
        throw new Error("durable checkpoint recovery must not tail");
      },
    });
    const invocation = {
      operation: "execute",
      leaseId: "lease-a",
      activation: "signed-context-activation",
      workload,
    };

    const first = await handler(invocation);
    const replay = await handler(invocation);

    expect(checkpointed).toMatchObject({
      result: {
        status: "rejected",
        code: "GROUNDING_REJECTED",
        providerOutput: { draft: rawSecret },
      },
    });
    expect(first).toEqual(replay);
    expect(first).toEqual({
      type: "terminal",
      status: "rejected",
      terminalReceipt: "signed-rejected-terminal",
      code: "GROUNDING_REJECTED",
      retryable: false,
    });
    expect(JSON.stringify(first)).not.toContain(rawSecret);
    expect(providerCalls).toBe(1);
  });

  it("finalizes an existing Attempt from its durable checkpoint without entering the Provider", async () => {
    let providerCalls = 0;
    let tailCalls = 0;
    const handler = createPaidWorkGenerationHandler({
      permitVerifier: {
        verify: async () => {
          throw new Error("permit verification is prepare-only");
        },
      },
      activationVerifier: {
        verify: async () => ({
          expiresAt: "2026-08-17T12:00:40.000Z",
          permitJti: "permit-jti-a",
        }),
      },
      leaseJournal: {
        prepare: async () => {
          throw new Error("prepare must not run during execute");
        },
        claimExecution: async () => ({
          status: "existing",
          attemptId: "attempt-a",
        }),
        status: async () => {
          throw new Error("status must not run during execute");
        },
        cancelExpired: async () => {
          throw new Error("cancellation must not run during execute");
        },
      },
      receiptSigner: {
        signLease: async () => {
          throw new Error("lease signing must not run during execute");
        },
        signStatus: async () => {
          throw new Error("status signing must not run during execute");
        },
        signTerminal: async () => "signed-recovered-terminal",
      },
      terminalStore: {
        recoverByScope: recoverByScopeMustNotRun,
        checkpoint: async () => {
          throw new Error("an existing Attempt must not overwrite its checkpoint");
        },
        recover: async () => ({
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
        }),
        markIndeterminate: async () => ({ state: "indeterminate" as const }),
        complete: async () => {
          throw new Error("recover owns checkpoint finalization");
        },
        reject: async () => {
          throw new Error("a checkpointed success must not be rejected");
        },
      },
      prepareAttempt: async () => ({
        requestPayload: { model: "fake-v1" },
        execute: async () => {
          providerCalls += 1;
          throw new Error("recovery must not enter the Provider");
        },
      }),
      tailExisting: async () => {
        tailCalls += 1;
        throw new Error("a checkpoint must not wait for an absent winner");
      },
    });

    await expect(
      handler({
        operation: "execute",
        leaseId: "lease-a",
        activation: "signed-context-activation",
        workload,
      }),
    ).resolves.toEqual({
      type: "terminal",
      status: "completed",
      terminalReceipt: "signed-recovered-terminal",
      draft: {
        id: "draft-a",
        generationId: "generation-a",
        revision: 1,
        text: "The treatment was explained well.",
        systemAnnotations: [],
      },
    });
    expect(providerCalls).toBe(0);
    expect(tailCalls).toBe(0);
  });

  it("marks an uncheckpointed Provider timeout indeterminate without a terminal rejection", async () => {
    const operations: string[] = [];
    const timeout = Object.assign(new Error("provider timeout"), {
      code: "timeout",
    });
    const handler = createPaidWorkGenerationHandler({
      permitVerifier: {
        verify: async () => {
          throw new Error("permit verification is prepare-only");
        },
      },
      activationVerifier: {
        verify: async () => ({
          expiresAt: "2026-08-17T12:00:40.000Z",
          permitJti: "permit-jti-a",
        }),
      },
      leaseJournal: {
        prepare: async () => {
          throw new Error("prepare must not run during execute");
        },
        claimExecution: async () => ({
          status: "claimed",
          attemptId: "attempt-a",
        }),
        status: async () => {
          throw new Error("status must not run during execute");
        },
        cancelExpired: async () => {
          throw new Error("cancellation must not run during execute");
        },
      },
      receiptSigner: {
        signLease: async () => "unused",
        signStatus: async () => "unused",
        signTerminal: async () => {
          throw new Error("indeterminate work has no terminal receipt");
        },
      },
      terminalStore: {
        recoverByScope: recoverByScopeMustNotRun,
        checkpoint: async () => {
          throw new Error("a timeout has no Provider result to checkpoint");
        },
        recover: async () => ({ state: "none" as const }),
        markIndeterminate: async (input) => {
          operations.push("indeterminate");
          expect(input).toMatchObject({ attemptId: "attempt-a" });
          return { state: "indeterminate" as const };
        },
        complete: async () => {
          throw new Error("a timeout cannot complete");
        },
        reject: async () => {
          operations.push("rejected");
          throw new Error("a timeout must remain indeterminate");
        },
      },
      prepareAttempt: async () => ({
        requestPayload: { model: "fake-v1" },
        execute: async () => {
          throw timeout;
        },
      }),
      tailExisting: async () => {
        throw new Error("a winning invocation must not tail");
      },
    });

    await expect(
      handler({
        operation: "execute",
        leaseId: "lease-a",
        activation: "signed-context-activation",
        workload,
      }),
    ).rejects.toThrow("PROVIDER_RESULT_INDETERMINATE");
    expect(operations).toEqual(["indeterminate"]);
  });

  it("finalizes and signs a checkpoint from status without entering the Provider", async () => {
    let providerCalls = 0;
    const handler = createPaidWorkGenerationHandler({
      permitVerifier: {
        verify: async () => {
          throw new Error("permit verification must not run during status");
        },
      },
      activationVerifier: {
        verify: async () => {
          throw new Error("activation verification must not run during status");
        },
      },
      leaseJournal: {
        prepare: async () => {
          throw new Error("prepare must not run during status");
        },
        claimExecution: async () => {
          throw new Error("claim must not run during status");
        },
        status: async () => {
          throw new Error("durable checkpoint recovery must precede lease status");
        },
        cancelExpired: async () => {
          throw new Error("cancel must not run during status");
        },
      },
      receiptSigner: {
        signLease: async () => {
          throw new Error("lease signing must not run during status");
        },
        signStatus: async () => {
          throw new Error("a recovered terminal needs a terminal receipt");
        },
        signTerminal: async (claims) => {
          expect(claims).toMatchObject({
            leaseId: "lease-a",
            permitJti: "permit-jti-a",
            generationId: "generation-a",
            outcome: "completed",
            actualCostMicros: 0,
          });
          return "signed-recovered-terminal";
        },
      },
      terminalStore: {
        checkpoint: async () => {
          throw new Error("status must not checkpoint again");
        },
        complete: async () => {
          throw new Error("scope recovery owns terminalization");
        },
        recover: async () => {
          throw new Error("status must use exact scope recovery");
        },
        recoverByScope: async (input) => {
          expect(input).toEqual({ permitJti: "permit-jti-a", workload });
          return {
            state: "completed" as const,
            leaseId: "lease-a",
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
        markIndeterminate: async () => {
          throw new Error("status must not mark a checkpoint indeterminate");
        },
        reject: async () => {
          throw new Error("status must not reject a checkpoint");
        },
      },
      prepareAttempt: async () => ({
        requestPayload: {},
        execute: async () => {
          providerCalls += 1;
          throw new Error("status must never enter the Provider");
        },
      }),
      tailExisting: async () => {
        throw new Error("status must not tail");
      },
    });

    await expect(
      handler({
        operation: "status",
        permitJti: "permit-jti-a",
        workload,
      }),
    ).resolves.toEqual({
      operation: "status",
      state: "terminal",
      terminalReceipt: "signed-recovered-terminal",
    });
    expect(providerCalls).toBe(0);
  });

  it.each([
    [
      {
        operation: "status" as const,
        permitJti: "permit-jti-a",
        workload,
      },
      {
        operation: "status",
        state: "leased",
        scope: {
          tenantId: "tenant-a",
          locationId: "location-a",
          reviewSessionId: "session-a",
          generationBatchId: "batch-a",
          generationId: "generation-a",
          permitJti: "permit-jti-a",
        },
      },
    ],
    [
      {
        operation: "cancel-expired-lease" as const,
        leaseId: "lease-a",
        scope: {
          tenantId: "tenant-a",
          locationId: "location-a",
          reviewSessionId: "session-a",
          generationBatchId: "batch-a",
          generationId: "generation-a",
          permitJti: "permit-jti-a",
        },
      },
      {
        operation: "cancel-expired-lease",
        state: "cancelled",
        leaseId: "lease-a",
        scope: {
          tenantId: "tenant-a",
          locationId: "location-a",
          reviewSessionId: "session-a",
          generationBatchId: "batch-a",
          generationId: "generation-a",
          permitJti: "permit-jti-a",
        },
      },
    ],
    [
      {
        operation: "status" as const,
        permitJti: "permit-jti-a",
        workload,
      },
      {
        operation: "status",
        state: "indeterminate",
        scope: {
          tenantId: "tenant-a",
          locationId: "location-a",
          reviewSessionId: "session-a",
          generationBatchId: "batch-a",
          generationId: "generation-a",
          permitJti: "permit-jti-a",
        },
      },
    ],
    [
      {
        operation: "cancel-expired-lease" as const,
        leaseId: "lease-a",
        scope: {
          tenantId: "tenant-a",
          locationId: "location-a",
          reviewSessionId: "session-a",
          generationBatchId: "batch-a",
          generationId: "generation-a",
          permitJti: "permit-jti-a",
        },
      },
      {
        operation: "cancel-expired-lease",
        state: "indeterminate",
        leaseId: "lease-a",
        scope: {
          tenantId: "tenant-a",
          locationId: "location-a",
          reviewSessionId: "session-a",
          generationBatchId: "batch-a",
          generationId: "generation-a",
          permitJti: "permit-jti-a",
        },
      },
    ],
  ])("returns signed reconciliation evidence for $operation", async (event, unsigned) => {
    const handler = createPaidWorkGenerationHandler({
      permitVerifier: {
        verify: async () => {
          throw new Error("permit verification must not run during reconciliation");
        },
      },
      activationVerifier: {
        verify: async () => {
          throw new Error("activation verification must not run during reconciliation");
        },
      },
      leaseJournal: {
        prepare: async () => {
          throw new Error("prepare must not run during reconciliation");
        },
        claimExecution: async () => {
          throw new Error("execution claim must not run during reconciliation");
        },
        status: async (scope) => {
          expect(scope).toEqual(unsigned.scope);
          return {
            state:
              unsigned.state === "indeterminate" ? "indeterminate" : "leased",
          };
        },
        cancelExpired: async (input) => {
          expect(input).toEqual({ leaseId: "lease-a", scope: unsigned.scope });
          return {
            state:
              unsigned.state === "indeterminate"
                ? "indeterminate"
                : "cancelled",
          };
        },
      },
      receiptSigner: {
        signLease: async () => {
          throw new Error("lease signing must not run during reconciliation");
        },
        signStatus: async (claims) => {
          expect(claims).toEqual(unsigned);
          return "signed-generation-status-receipt";
        },
        signTerminal: async () => {
          throw new Error("terminal signing must not run during reconciliation");
        },
      },
      terminalStore: {
        checkpoint: async () => {
          throw new Error("terminal checkpoint must not run during reconciliation");
        },
        complete: async () => {
          throw new Error("terminal persistence must not run during reconciliation");
        },
        recover: async () => {
          throw new Error("terminal recovery must not run during reconciliation");
        },
        recoverByScope: async (input) => {
          if (event.operation !== "status") {
            throw new Error("scope recovery must not run during cancellation");
          }
          expect(input).toEqual({ permitJti: "permit-jti-a", workload });
          return unsigned.state === "indeterminate"
            ? ({ state: "indeterminate" } as const)
            : ({ state: "none" } as const);
        },
        markIndeterminate: async () => {
          throw new Error("indeterminate state must not run during reconciliation");
        },
        reject: async () => {
          throw new Error("terminal rejection must not run during reconciliation");
        },
      },
      prepareAttempt: async () => {
        throw new Error("provider request must not prepare during reconciliation");
      },
      tailExisting: async () => {
        throw new Error("tail must not run during reconciliation");
      },
    });

    await expect(handler(event)).resolves.toEqual({
      operation: unsigned.operation,
      state: unsigned.state,
      signedStatusReceipt: "signed-generation-status-receipt",
    });
  });
});
