import { describe, expect, it } from "vitest";

import { createHttpReviewerDraftRevisionClient } from "./reviewer-draft-revision-client.js";

describe("reviewer Draft revision HTTP client", () => {
  it("sends an optimistic autosave with an exact body hash", async () => {
    let received:
      | {
          readonly input: RequestInfo | URL;
          readonly init: RequestInit | undefined;
        }
      | undefined;
    const client = createHttpReviewerDraftRevisionClient(async (input, init) => {
      received = { input, init };
      return Response.json({ status: "recorded", revision: 2 });
    });

    await expect(
      client.save({
        reviewSessionHandle: "review-session-handle",
        idempotencyKey: "draft-save-a",
        draftId: "draft-a",
        generationId: "generation-a",
        expectedRevision: 1,
        text: "The team was exceptionally attentive.",
      }),
    ).resolves.toEqual({ status: "recorded", revision: 2 });
    expect(received?.input).toBe(
      "/api/v1/review-sessions/review-session-handle/draft-revisions",
    );
    expect(received?.init).toMatchObject({
      method: "PUT",
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify({
        draftId: "draft-a",
        generationId: "generation-a",
        expectedRevision: 1,
        text: "The team was exceptionally attentive.",
      }),
    });
    expect(received?.init?.headers).toMatchObject({
      "Idempotency-Key": "draft-save-a",
      "x-amz-content-sha256": expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it("surfaces a server conflict without treating it as transport failure", async () => {
    const client = createHttpReviewerDraftRevisionClient(async () =>
      Response.json({ status: "conflict", revision: 3 }, { status: 409 }),
    );

    await expect(
      client.save({
        reviewSessionHandle: "review-session-handle",
        idempotencyKey: "draft-save-stale",
        draftId: "draft-a",
        generationId: "generation-a",
        expectedRevision: 1,
        text: "A stale edit.",
      }),
    ).resolves.toEqual({ status: "conflict", revision: 3 });
  });
});
