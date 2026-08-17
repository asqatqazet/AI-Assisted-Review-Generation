import { describe, expect, it } from "vitest";

import { createHttpEntryChallengeClient } from "./entry-challenge-client.js";

describe("HTTP Entry Challenge client", () => {
  it("starts a Review Session with a payload-bound POST", async () => {
    const requests: Array<{ input: string; init: RequestInit }> = [];
    const fetchFn: typeof fetch = async (input, init = {}) => {
      requests.push({ input: String(input), init });
      const response = new Response("<!doctype html>", { status: 200 });
      Object.defineProperty(response, "url", {
        value: "https://reviews.example.test/review/review-session-demo",
      });
      return response;
    };
    const client = createHttpEntryChallengeClient(fetchFn);

    const result = await client.start(
      {
        entryChallengeHandle: "entry-challenge-demo",
        rating: 5,
        action: "generate",
        csrfToken: "csrf-token-with-at-least-thirty-two-characters",
      },
      new AbortController().signal,
    );
    const request = requests[0];
    const headers = new Headers(request?.init.headers);

    expect({
      input: request?.input,
      method: request?.init.method,
      credentials: request?.init.credentials,
      contentType: headers.get("Content-Type"),
      payloadHash: headers.get("x-amz-content-sha256"),
      body: request?.init.body,
      result,
    }).toEqual({
      input: "/api/v1/entry-challenges/entry-challenge-demo/start",
      method: "POST",
      credentials: "same-origin",
      contentType: "application/x-www-form-urlencoded;charset=UTF-8",
      payloadHash:
        "4f5e2446be3e85dd25601ad0c68de2fe182e96eb95c974c577020922ce66730e",
      body:
        "rating=5&action=generate&csrfToken=csrf-token-with-at-least-thirty-two-characters",
      result: { redirectTo: "/review/review-session-demo" },
    });
  });
});
