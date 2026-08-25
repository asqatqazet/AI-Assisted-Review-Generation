import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { createWebBffApp } from "./app.js";
import type { ContextPort } from "./ports/context.port.js";

const unavailableContext: ContextPort = {
  prepareEntry: async () => ({ status: "unavailable" }),
  readEntryChallenge: async () => ({ status: "unavailable" }),
  advanceEntry: async () => ({ status: "unavailable" }),
  verifyEntry: async () => ({ status: "unavailable" }),
  readReviewSession: async () => ({ status: "unavailable" }),
};

const body = JSON.stringify({
  draftId: "draft-a",
  generationId: "generation-a",
  expectedRevision: 1,
  text: "The team was exceptionally attentive.",
});

describe("US-02.3 reviewer Draft revision BFF", () => {
  it("authorizes an exact browser-bound edit before invoking Generation", async () => {
    const calls: unknown[] = [];
    const app = createWebBffApp({
      contextPort: unavailableContext,
      publicOrigin: "https://reviews.example.test",
      reviewerDraftRevisionContextPort: {
        authorize: async (input) => {
          calls.push({ context: input });
          return {
            status: "authorized",
            permit: "signed-draft-revision-permit",
            scope: {
              tenantId: "tenant-a",
              locationId: "location-a",
              reviewSessionId: "review-session-a",
              draftId: input.draftId,
              generationId: input.generationId,
              expectedRevision: input.expectedRevision,
              textHash: input.textHash,
              idempotencyKey: input.idempotencyKey,
            },
          };
        },
      },
      reviewerDraftRevisionExecutionPort: {
        record: async (input) => {
          calls.push({ generation: input });
          return { status: "recorded", revision: 2 };
        },
      },
    });

    const response = await app.request(
      "/api/v1/review-sessions/review-session-handle/draft-revisions",
      {
        method: "PUT",
        headers: {
          Origin: "https://reviews.example.test",
          Cookie: "__Host-review_browser=browser-capability-123456789",
          "Content-Type": "application/json",
          "Idempotency-Key": "draft-save-a",
          "x-amz-content-sha256": createHash("sha256")
            .update(body)
            .digest("hex"),
        },
        body,
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "recorded", revision: 2 });
    expect(calls[0]).toMatchObject({
      context: {
        reviewSessionHandle: "review-session-handle",
        browserCapability: "browser-capability-123456789",
        idempotencyKey: "draft-save-a",
        draftId: "draft-a",
        generationId: "generation-a",
        expectedRevision: 1,
        textHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      },
    });
    expect(calls[1]).toEqual({
      generation: {
        permit: "signed-draft-revision-permit",
        scope: expect.objectContaining({ reviewSessionId: "review-session-a" }),
        text: "The team was exceptionally attentive.",
      },
    });
  });

  it("maps optimistic conflicts to 409 and never fabricates success", async () => {
    const app = createWebBffApp({
      contextPort: unavailableContext,
      publicOrigin: "https://reviews.example.test",
      reviewerDraftRevisionContextPort: {
        authorize: async (input) => ({
          status: "authorized",
          permit: "signed-draft-revision-permit",
          scope: {
            tenantId: "tenant-a",
            locationId: "location-a",
            reviewSessionId: "review-session-a",
            draftId: input.draftId,
            generationId: input.generationId,
            expectedRevision: input.expectedRevision,
            textHash: input.textHash,
            idempotencyKey: input.idempotencyKey,
          },
        }),
      },
      reviewerDraftRevisionExecutionPort: {
        record: async () => ({ status: "conflict", revision: 3 }),
      },
    });
    const response = await app.request(
      "/api/v1/review-sessions/review-session-handle/draft-revisions",
      {
        method: "PUT",
        headers: {
          Origin: "https://reviews.example.test",
          Cookie: "__Host-review_browser=browser-capability-123456789",
          "Content-Type": "application/json",
          "Idempotency-Key": "draft-save-stale",
          "x-amz-content-sha256": createHash("sha256")
            .update(body)
            .digest("hex"),
        },
        body,
      },
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ status: "conflict", revision: 3 });
  });

  it("does not authorize cross-origin or unbound edits", async () => {
    let called = false;
    const app = createWebBffApp({
      contextPort: unavailableContext,
      publicOrigin: "https://reviews.example.test",
      reviewerDraftRevisionContextPort: {
        authorize: async () => {
          called = true;
          return { status: "rejected" };
        },
      },
      reviewerDraftRevisionExecutionPort: {
        record: async () => {
          called = true;
          throw new Error("must not call");
        },
      },
    });
    const response = await app.request(
      "/api/v1/review-sessions/review-session-handle/draft-revisions",
      {
        method: "PUT",
        headers: {
          Origin: "https://attacker.example",
          Cookie: "__Host-review_browser=browser-capability-123456789",
          "Idempotency-Key": "draft-save-a",
          "x-amz-content-sha256": createHash("sha256")
            .update(body)
            .digest("hex"),
        },
        body,
      },
    );
    expect(response.status).toBe(404);
    expect(called).toBe(false);
  });
});
