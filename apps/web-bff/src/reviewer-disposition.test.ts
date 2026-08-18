import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { createWebBffApp } from "./app.js";
import type { ContextPort } from "./ports/context.port.js";

const unavailableContext: ContextPort = {
  prepareEntry: async () => ({ status: "unavailable" }),
  readEntryChallenge: async () => ({ status: "unavailable" }),
  advanceEntry: async () => ({ status: "unavailable" }),
  readReviewSession: async () => ({ status: "unavailable" }),
};

describe("US-03.6 reviewer Draft disposition BFF", () => {
  it("authorizes browser-bound scope then invokes the private Generation service", async () => {
    const calls: unknown[] = [];
    const body = JSON.stringify({
      draftId: "draft-a",
      generationId: "generation-a",
      finalText: "The team was exceptionally attentive.",
    });
    const app = createWebBffApp({
      contextPort: unavailableContext,
      publicOrigin: "https://reviews.example.test",
      reviewerDispositionContextPort: {
        authorize: async (input) => {
          calls.push({ context: input });
          return {
            status: "authorized",
            permit: "signed-disposition-permit",
            scope: {
              tenantId: "tenant-a",
              locationId: "location-a",
              reviewSessionId: "review-session-a",
              draftId: input.draftId,
              generationId: input.generationId,
              finalTextHash: input.finalTextHash,
              idempotencyKey: input.idempotencyKey,
            },
          };
        },
      },
      reviewerDispositionExecutionPort: {
        record: async (input) => {
          calls.push({ generation: input });
          return {
            status: "recorded",
            kind: "edited",
            revision: 2,
            normalizedEditDistance: 0.21,
          };
        },
      },
    });

    const response = await app.request(
      "/api/v1/review-sessions/review-session-handle/dispositions",
      {
        method: "POST",
        headers: {
          Origin: "https://reviews.example.test",
          Cookie: "__Host-review_browser=browser-capability-123456789",
          "Content-Type": "application/json",
          "Idempotency-Key": "disposition-a",
          "x-amz-content-sha256": createHash("sha256").update(body).digest("hex"),
        },
        body,
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "recorded",
      kind: "edited",
      revision: 2,
      normalizedEditDistance: 0.21,
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      context: {
        reviewSessionHandle: "review-session-handle",
        browserCapability: "browser-capability-123456789",
        idempotencyKey: "disposition-a",
        draftId: "draft-a",
        generationId: "generation-a",
      },
    });
    expect(calls[1]).toEqual({
      generation: {
        permit: "signed-disposition-permit",
        scope: expect.objectContaining({
          reviewSessionId: "review-session-a",
          finalTextHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        }),
        finalText: "The team was exceptionally attentive.",
      },
    });
  });

  it("does not call either service for a cross-origin request", async () => {
    let called = false;
    const body = JSON.stringify({
      draftId: "draft-a",
      generationId: "generation-a",
      finalText: "The team was attentive.",
    });
    const app = createWebBffApp({
      contextPort: unavailableContext,
      publicOrigin: "https://reviews.example.test",
      reviewerDispositionContextPort: {
        authorize: async () => {
          called = true;
          return { status: "rejected" };
        },
      },
      reviewerDispositionExecutionPort: {
        record: async () => {
          called = true;
          throw new Error("must not call");
        },
      },
    });

    const response = await app.request(
      "/api/v1/review-sessions/review-session-handle/dispositions",
      {
        method: "POST",
        headers: {
          Origin: "https://attacker.example",
          Cookie: "__Host-review_browser=browser-capability-123456789",
          "Content-Type": "application/json",
          "Idempotency-Key": "disposition-a",
          "x-amz-content-sha256": createHash("sha256").update(body).digest("hex"),
        },
        body,
      },
    );

    expect(response.status).toBe(404);
    expect(called).toBe(false);
  });
});
