import { describe, expect, it } from "vitest";

import { createContextFunctionHandler } from "./context-function.js";

describe("private Context Function", () => {
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

  it("resolves current Operator Access Grants from a verified OIDC identity", async () => {
    let received: unknown;
    const entryService = {
      prepareEntry: async () => ({ status: "unavailable" as const }),
      readEntryChallenge: async () => ({ status: "unavailable" as const }),
      advanceEntry: async () => ({ status: "unavailable" as const }),
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
});
