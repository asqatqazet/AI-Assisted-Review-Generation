import { describe, expect, it } from "vitest";

import {
  createInvokedConsoleBenchAuthorizationPort,
  createInvokedContextPort,
  createInvokedOperatorContextPort,
  createInvokedPublicSourceRateLimitPort,
  createInvokedReviewerGenerationContextPort,
} from "./context-function.port.js";

describe("invoked Context port", () => {
  it("consumes a server-selected public source policy through reviewer Context", async () => {
    let received: unknown;
    const port = createInvokedPublicSourceRateLimitPort({
      invoke: async (request) => {
        received = request;
        return {
          operation: "consume-public-source-rate-limit",
          result: { status: "limited", retryAfterSeconds: 23 },
        };
      },
    });

    await expect(
      port.consume({
        policy: "generation",
        sourceAddress: "203.0.113.8",
      }),
    ).resolves.toEqual({ status: "limited", retryAfterSeconds: 23 });
    expect(received).toEqual({
      operation: "consume-public-source-rate-limit",
      input: { policy: "generation", sourceAddress: "203.0.113.8" },
    });
  });

  it("uses the dedicated Context Bench authorization operation", async () => {
    let received: unknown;
    const port = createInvokedConsoleBenchAuthorizationPort({
      invoke: async (request) => {
        received = request;
        return {
          operation: "authorize-console-bench",
          result: { status: "not-found" },
        };
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
        action: "generate" as const,
        styleId: "format-a",
        promptVersionId: "prompt-a",
        provider: "fake",
        keywordIds: ["fact-a"],
        freeText: "",
        sourceText: "",
      },
    };
    await expect(port.authorize(input)).resolves.toEqual({ status: "not-found" });
    expect(received).toEqual({ operation: "authorize-console-bench", input });
  });

  it("prepares an entry through the private Context Function contract", async () => {
    let received: unknown;
    const contextPort = createInvokedContextPort({
      invoke: async (request) => {
        received = request;
        return {
          operation: "prepare-entry",
          result: {
            status: "prepared",
            entryChallengeHandle: "entry-challenge-demo",
          },
        };
      },
    });

    await expect(
      contextPort.prepareEntry({
        tenantSlug: "apex-dental",
        locationSlug: "central",
        invitationToken: "secret-invitation-token",
        tableRef: "Chair-2",
        browserCapability: "existing-browser-capability-123",
      }),
    ).resolves.toEqual({
      status: "prepared",
      entryChallengeHandle: "entry-challenge-demo",
    });

    expect(received).toEqual({
      operation: "prepare-entry",
      input: {
        tenantSlug: "apex-dental",
        locationSlug: "central",
        invitationToken: "secret-invitation-token",
        tableRef: "Chair-2",
        browserCapability: "existing-browser-capability-123",
      },
    });
  });

  it("pins prepare-entry to the BFF release's immutable Configuration Release", async () => {
    let received: unknown;
    const contextPort = createInvokedContextPort(
      {
        invoke: async (request) => {
          received = request;
          return {
            operation: "prepare-entry",
            result: {
              status: "prepared",
              entryChallengeHandle: "entry-challenge-demo",
            },
          };
        },
      },
      { configurationReleaseId: "018fd2d8-7f24-4d21-8b10-7dd983cfc487" },
    );

    await contextPort.prepareEntry({
      tenantSlug: "apex-dental",
      locationSlug: "central",
      invitationToken: undefined,
      tableRef: undefined,
      browserCapability: "existing-browser-capability-123",
    });

    expect(received).toEqual({
      operation: "prepare-entry",
      input: {
        tenantSlug: "apex-dental",
        locationSlug: "central",
        browserCapability: "existing-browser-capability-123",
        configurationReleaseId: "018fd2d8-7f24-4d21-8b10-7dd983cfc487",
      },
    });
  });

  it("saves Review Session progress without forwarding browser-selected scope", async () => {
    let received: unknown;
    const contextPort = createInvokedContextPort({
      invoke: async (request) => {
        received = request;
        return {
          operation: "save-review-session-progress",
          result: {
            status: "saved",
            progress: {
              epoch: 3,
              phase: "format",
              selectedFactOptionIds: ["fact-a"],
              customerAssertion: "",
              sourceText: "",
              selectedReviewFormatId: null,
            },
          },
        };
      },
    });

    await expect(
      contextPort.saveReviewSessionProgress!({
        reviewSessionHandle: "review-session-demo",
        browserCapability: "browser-capability-123456789",
        expectedEpoch: 2,
        progress: {
          phase: "format",
          selectedFactOptionIds: ["fact-a"],
          customerAssertion: "",
          sourceText: "",
          selectedReviewFormatId: null,
        },
      }),
    ).resolves.toMatchObject({ status: "saved", progress: { epoch: 3 } });
    expect(received).toEqual({
      operation: "save-review-session-progress",
      input: {
        reviewSessionHandle: "review-session-demo",
        browserCapability: "browser-capability-123456789",
        expectedEpoch: 2,
        progress: {
          phase: "format",
          selectedFactOptionIds: ["fact-a"],
          customerAssertion: "",
          sourceText: "",
          selectedReviewFormatId: null,
        },
      },
    });
  });

  it("verifies an Entry Challenge without accepting browser-selected scope", async () => {
    let received: unknown;
    const contextPort = createInvokedContextPort({
      invoke: async (request) => {
        received = request;
        return {
          operation: "verify-entry",
          result: {
            status: "admitted",
            reviewSessionHandle: "review-session-demo",
          },
        };
      },
    });

    await expect(
      contextPort.verifyEntry!({
        entryChallengeHandle: "entry-challenge-demo",
        browserCapability: "browser-capability-123456789",
        verificationEvidence: "BS-4471-K",
      }),
    ).resolves.toEqual({
      status: "admitted",
      reviewSessionHandle: "review-session-demo",
    });
    expect(received).toEqual({
      operation: "verify-entry",
      input: {
        entryChallengeHandle: "entry-challenge-demo",
        browserCapability: "browser-capability-123456789",
        verificationEvidence: "BS-4471-K",
      },
    });
  });

  it("forgets only the browser-bound Review Session through Context", async () => {
    let received: unknown;
    const contextPort = createInvokedContextPort({
      invoke: async (request) => {
        received = request;
        return {
          operation: "forget-review-session",
          result: { status: "forgotten" },
        };
      },
    });

    await expect(
      contextPort.forgetReviewSession!({
        reviewSessionHandle: "review-session-demo",
        browserCapability: "browser-capability-123456789",
      }),
    ).resolves.toEqual({ status: "forgotten" });
    expect(received).toEqual({
      operation: "forget-review-session",
      input: {
        reviewSessionHandle: "review-session-demo",
        browserCapability: "browser-capability-123456789",
      },
    });
  });

  it("resolves Operator Access without accepting a browser-selected role or Tenant", async () => {
    let received: unknown;
    const port = createInvokedOperatorContextPort({
      invoke: async (request) => {
        received = request;
        return {
          operation: "resolve-operator-access",
          result: { status: "unauthorized" },
        };
      },
    });
    const identity = {
      issuer:
        "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_pool",
      subject: "cognito-subject-123",
      email: "owner@example.com",
    };

    await expect(port.resolveAccess(identity)).resolves.toEqual({
      status: "unauthorized",
    });
    expect(received).toEqual({
      operation: "resolve-operator-access",
      input: { identity },
    });
  });
});

describe("invoked reviewer Generation Context port", () => {
  it("prepares paid work without accepting a caller-selected Tenant", async () => {
    let received: unknown;
    const contextPort = createInvokedReviewerGenerationContextPort({
      invoke: async (request) => {
        received = request;
        return {
          operation: "prepare-reviewer-generation",
          result: {
            status: "rejected",
            code: "BUDGET_EXCEEDED",
            retryable: false,
          },
        };
      },
    });

    await expect(
      contextPort.prepare({
        reviewSessionHandle: "review-session-demo",
        browserCapability: "browser-capability-123456789",
        idempotencyKey: "request-a",
        command: {
          factOptionIds: ["fact-a"],
          reviewFormatId: "format-a",
        },
      }),
    ).resolves.toEqual({
      status: "rejected",
      code: "BUDGET_EXCEEDED",
      retryable: false,
    });
    expect(received).toEqual({
      operation: "prepare-reviewer-generation",
      input: {
        reviewSessionHandle: "review-session-demo",
        browserCapability: "browser-capability-123456789",
        idempotencyKey: "request-a",
        command: {
          factOptionIds: ["fact-a"],
          reviewFormatId: "format-a",
        },
      },
    });
  });
});
