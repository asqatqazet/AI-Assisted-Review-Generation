import { describe, expect, it } from "vitest";

import { createHttpReviewerDispositionClient } from "./reviewer-disposition-client.js";

describe("reviewer Disposition HTTP client", () => {
  it("sends the exact final text through the scoped BFF route", async () => {
    let received:
      | {
          readonly input: RequestInfo | URL;
          readonly init: RequestInit | undefined;
        }
      | undefined;
    const client = createHttpReviewerDispositionClient(async (input, init) => {
      received = { input, init };
      return Response.json({
        status: "recorded",
        kind: "edited",
        revision: 2,
        normalizedEditDistance: 0.21,
      });
    });

    await expect(
      client.record({
        reviewSessionHandle: "review-session-handle",
        idempotencyKey: "disposition-a",
        draftId: "draft-a",
        generationId: "generation-a",
        finalText: "The team was exceptionally attentive.",
      }),
    ).resolves.toMatchObject({ kind: "edited", revision: 2 });

    expect(received?.input).toBe(
      "/api/v1/review-sessions/review-session-handle/dispositions",
    );
    expect(received?.init).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify({
        draftId: "draft-a",
        generationId: "generation-a",
        finalText: "The team was exceptionally attentive.",
      }),
    });
    expect(received?.init?.headers).toMatchObject({
      "Idempotency-Key": "disposition-a",
      "x-amz-content-sha256": expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });
});
