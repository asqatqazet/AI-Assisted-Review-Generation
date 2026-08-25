import { describe, expect, it } from "vitest";

import { createContextFunctionHandler } from "./context-function.js";

describe("private Context Function", () => {
  it("consumes a public source limit only through the reviewer application seam", async () => {
    let received: unknown;
    const handler = createContextFunctionHandler({
      entryService: {
        prepareEntry: async () => ({ status: "unavailable" }),
        readEntryChallenge: async () => ({ status: "unavailable" }),
        advanceEntry: async () => ({ status: "unavailable" }),
        verifyEntry: async () => ({ status: "unavailable" }),
        readReviewSession: async () => ({ status: "unavailable" }),
        prepareReviewerDisposition: async () => ({ status: "rejected" }),
        prepareReviewerGeneration: async () => ({
          status: "rejected",
          code: "GENERATION_FAILED",
          retryable: true,
        }),
        activateGeneration: async () => ({ status: "rejected" }),
        settleGeneration: async () => ({ status: "rejected" }),
        listReconciliationCandidates: async () => ({ candidates: [] }),
        releaseReconciledGeneration: async () => ({ status: "rejected" }),
      },
      publicSourceRateLimiter: {
        consume: async (input) => {
          received = input;
          return { status: "limited", retryAfterSeconds: 17 };
        },
      },
    });

    await expect(
      handler({
        operation: "consume-public-source-rate-limit",
        input: {
          policy: "entry-start",
          sourceAddress: "203.0.113.8",
        },
      }),
    ).resolves.toEqual({
      operation: "consume-public-source-rate-limit",
      result: { status: "limited", retryAfterSeconds: 17 },
    });
    expect(received).toEqual({
      policy: "entry-start",
      sourceAddress: "203.0.113.8",
    });
  });

  it("prepares an Entry Challenge through the Context-owned application boundary", async () => {
    let received: unknown;
    const handler = createContextFunctionHandler({
      entryService: {
        prepareEntry: async (input) => {
          received = input;
          return {
            status: "prepared",
            entryChallengeHandle: "entry-challenge-demo",
          };
        },
        readEntryChallenge: async () => ({ status: "unavailable" }),
        advanceEntry: async () => ({ status: "unavailable" }),
        verifyEntry: async () => ({ status: "unavailable" }),
        readReviewSession: async () => ({ status: "unavailable" }),
        prepareReviewerDisposition: async () => ({ status: "rejected" }),
        prepareReviewerGeneration: async () => ({
          status: "rejected",
          code: "GENERATION_FAILED",
          retryable: true,
        }),
        activateGeneration: async () => ({ status: "rejected" }),
        settleGeneration: async () => ({ status: "rejected" }),
        listReconciliationCandidates: async () => ({ candidates: [] }),
        releaseReconciledGeneration: async () => ({ status: "rejected" }),
      },
    });

    await expect(
      handler({
        operation: "prepare-entry",
        input: {
          tenantSlug: "apex-dental",
          locationSlug: "central",
          invitationToken: "secret-invitation-token",
          tableRef: "Chair-2",
          browserCapability: "existing-browser-capability-123",
        },
      }),
    ).resolves.toEqual({
      operation: "prepare-entry",
      result: {
        status: "prepared",
        entryChallengeHandle: "entry-challenge-demo",
      },
    });

    expect(received).toEqual({
      tenantSlug: "apex-dental",
      locationSlug: "central",
      invitationToken: "secret-invitation-token",
      tableRef: "Chair-2",
      browserCapability: "existing-browser-capability-123",
    });
  });

  it("routes browser-bound verification evidence without accepting scope identity", async () => {
    let received: unknown;
    const handler = createContextFunctionHandler({
      entryService: {
        prepareEntry: async () => ({ status: "unavailable" }),
        readEntryChallenge: async () => ({ status: "unavailable" }),
        advanceEntry: async () => ({ status: "unavailable" }),
        verifyEntry: async (input) => {
          received = input;
          return {
            status: "admitted",
            reviewSessionHandle: "review-session-route",
          };
        },
        readReviewSession: async () => ({ status: "unavailable" }),
        prepareReviewerDisposition: async () => ({ status: "rejected" }),
        prepareReviewerGeneration: async () => ({
          status: "rejected",
          code: "GENERATION_FAILED",
          retryable: true,
        }),
        activateGeneration: async () => ({ status: "rejected" }),
        settleGeneration: async () => ({ status: "rejected" }),
        listReconciliationCandidates: async () => ({ candidates: [] }),
        releaseReconciledGeneration: async () => ({ status: "rejected" }),
      },
    });

    await expect(
      handler({
        operation: "verify-entry",
        input: {
          entryChallengeHandle: "entry-challenge-demo",
          browserCapability: "existing-browser-capability-123",
          verificationEvidence: "Booking-A7",
        },
      }),
    ).resolves.toEqual({
      operation: "verify-entry",
      result: {
        status: "admitted",
        reviewSessionHandle: "review-session-route",
      },
    });
    expect(received).toEqual({
      entryChallengeHandle: "entry-challenge-demo",
      browserCapability: "existing-browser-capability-123",
      verificationEvidence: "Booking-A7",
    });
  });

  it("resolves current Operator Access Grants from a verified OIDC identity", async () => {
    let received: unknown;
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
        retryable: true,
      }),
      activateGeneration: async () => ({ status: "rejected" as const }),
      settleGeneration: async () => ({ status: "rejected" as const }),
      listReconciliationCandidates: async () => ({ candidates: [] }),
      releaseReconciledGeneration: async () => ({ status: "rejected" as const }),
    };
    const options = {
      entryService,
      operatorService: {
        resolveAccess: async (input: unknown) => {
          received = input;
          return {
            status: "authorized" as const,
            operator: {
              id: "00000000-0000-4000-8000-000000000301",
              email: "owner@example.com",
            },
            platformGrants: [],
            tenantGrants: [
              {
                tenantId: "00000000-0000-4000-8000-000000000101",
                tenantSlug: "speicher-neun",
                tenantName: "Speicher Neun",
                roleKey: "tenant_admin",
                capabilities: ["console:read", "tenant:configure"],
                locations: [],
              },
            ],
          };
        },
      },
    };
    const handler = createContextFunctionHandler(options);

    await expect(
      handler({
        operation: "resolve-operator-access",
        input: {
          identity: {
            issuer:
              "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_pool",
            subject: "cognito-subject-123",
            email: "owner@example.com",
          },
        },
      }),
    ).resolves.toMatchObject({
      operation: "resolve-operator-access",
      result: {
        status: "authorized",
        operator: { email: "owner@example.com" },
        tenantGrants: [
          {
            tenantSlug: "speicher-neun",
            roleKey: "tenant_admin",
          },
        ],
      },
    });
    expect(received).toEqual({
      identity: {
        issuer:
          "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_pool",
        subject: "cognito-subject-123",
        email: "owner@example.com",
      },
    });
  });

  it("routes Bench authorization without routing execution through Context", async () => {
    let received: unknown;
    const handler = createContextFunctionHandler({
      entryService: {
        prepareEntry: async () => ({ status: "unavailable" }),
        readEntryChallenge: async () => ({ status: "unavailable" }),
        advanceEntry: async () => ({ status: "unavailable" }),
        verifyEntry: async () => ({ status: "unavailable" }),
        readReviewSession: async () => ({ status: "unavailable" }),
        prepareReviewerDisposition: async () => ({ status: "rejected" }),
        prepareReviewerGeneration: async () => ({
          status: "rejected",
          code: "GENERATION_FAILED",
          retryable: true,
        }),
        activateGeneration: async () => ({ status: "rejected" }),
        settleGeneration: async () => ({ status: "rejected" }),
        listReconciliationCandidates: async () => ({ candidates: [] }),
        releaseReconciledGeneration: async () => ({ status: "rejected" }),
      },
      consoleBenchAuthorizer: {
        authorize: async (input) => {
          received = input;
          return { status: "not-found" };
        },
      },
    });

    const input = {
      identity: {
        issuer: "https://issuer.example.test",
        subject: "operator-a",
        email: "operator@example.test",
      },
      scope: { tenantId: "tenant-a", locationId: "location-a" },
      input: {
        action: "generate",
        styleId: "format-a@1",
        promptVersionId: "prompt-generate@1",
        provider: "fake",
        keywordIds: ["fact-a"],
        freeText: "",
        sourceText: "",
      },
    } as const;
    await expect(
      handler({ operation: "authorize-console-bench", input }),
    ).resolves.toEqual({
      operation: "authorize-console-bench",
      result: { status: "not-found" },
    });
    expect(received).toEqual(input);
  });
});
