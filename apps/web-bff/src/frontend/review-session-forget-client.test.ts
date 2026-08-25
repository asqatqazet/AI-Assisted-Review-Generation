import { describe, expect, it } from "vitest";

import { createHttpReviewSessionForgetClient } from "./review-session-forget-client.js";

describe("Forget this review HTTP client", () => {
  it("revokes one Review Session without clearing the shared browser cookie", async () => {
    let received:
      | {
          readonly input: RequestInfo | URL;
          readonly init: RequestInit | undefined;
        }
      | undefined;
    const client = createHttpReviewSessionForgetClient(async (input, init) => {
      received = { input, init };
      return new Response(null, { status: 204 });
    });

    await expect(
      client.forget({ reviewSessionHandle: "review-session-handle" }),
    ).resolves.toBeUndefined();
    expect(received?.input).toBe(
      "/api/v1/review-sessions/review-session-handle",
    );
    expect(received?.init).toMatchObject({
      method: "DELETE",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "x-amz-content-sha256": expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
    expect(received?.init?.body).toBeUndefined();
  });
});
