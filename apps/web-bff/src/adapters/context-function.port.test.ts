import { describe, expect, it } from "vitest";

import {
  createInvokedContextPort,
  createInvokedOperatorContextPort,
  createInvokedReviewerGenerationContextPort,
} from "./context-function.port.js";

describe("invoked Context port", () => {
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
