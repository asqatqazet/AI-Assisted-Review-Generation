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

  it("keeps the reviewer on the Entry Challenge when verification is required", async () => {
    const fetchFn: typeof fetch = async () =>
      new Response(JSON.stringify({ status: "verification-required" }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      });
    const client = createHttpEntryChallengeClient(fetchFn);

    await expect(
      client.start(
        {
          entryChallengeHandle: "entry-challenge-demo",
          rating: 4,
          action: "paraphrase",
          csrfToken: "csrf-token-with-at-least-thirty-two-characters",
        },
        new AbortController().signal,
      ),
    ).resolves.toEqual({ status: "verification-required" });
  });

  it("submits only opaque verification evidence and the bound CSRF token", async () => {
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

    const result = await client.verify(
      {
        entryChallengeHandle: "entry-challenge-demo",
        verificationEvidence: "BS-4471-K",
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
      input: "/api/v1/entry-challenges/entry-challenge-demo/verify",
      method: "POST",
      credentials: "same-origin",
      contentType: "application/x-www-form-urlencoded;charset=UTF-8",
      payloadHash:
        "b670a9036239af56a13f778adac2c03777804a45f231161c186463eedf1ca96e",
      body:
        "verificationEvidence=BS-4471-K&csrfToken=csrf-token-with-at-least-thirty-two-characters",
      result: { redirectTo: "/review/review-session-demo" },
    });
  });
});
