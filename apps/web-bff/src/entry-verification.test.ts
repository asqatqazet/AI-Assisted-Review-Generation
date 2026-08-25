import { describe, expect, it } from "vitest";

import { createWebBffApp } from "./app.js";
import type { ContextPort, VerifyEntryInput } from "./ports/context.port.js";

const encoder = new TextEncoder();

async function sha256Hex(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    encoder.encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

describe("reviewer entry verification", () => {
  it("redirects after Context admits opaque evidence for the bound browser", async () => {
    let received: VerifyEntryInput | undefined;
    const contextPort: ContextPort = {
      prepareEntry: async () => ({ status: "unavailable" }),
      readEntryChallenge: async () => ({ status: "unavailable" }),
      advanceEntry: async () => ({ status: "unavailable" }),
      verifyEntry: async (input) => {
        received = input;
        return {
          status: "admitted",
          reviewSessionHandle: "review-session-demo",
        };
      },
      readReviewSession: async () => ({ status: "unavailable" }),
    };
    const app = createWebBffApp({
      contextPort,
      publicOrigin: "https://reviews.example.test",
      csrfProtector: {
        issue: async () => "csrf-token-with-at-least-thirty-two-characters",
        verify: async () => true,
      },
    });
    const body = new URLSearchParams({
      verificationEvidence: "BS-4471-K",
      csrfToken: "csrf-token-with-at-least-thirty-two-characters",
    }).toString();

    const response = await app.request(
      "/api/v1/entry-challenges/entry-challenge-demo/verify",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          Cookie: "__Host-review_browser=existing-browser-capability-123",
          Origin: "https://reviews.example.test",
          "x-amz-content-sha256": await sha256Hex(body),
        },
        body,
      },
    );

    expect({
      status: response.status,
      location: response.headers.get("location"),
      cacheControl: response.headers.get("cache-control"),
      received,
    }).toEqual({
      status: 303,
      location: "/review/review-session-demo",
      cacheControl: "private, no-store",
      received: {
        entryChallengeHandle: "entry-challenge-demo",
        browserCapability: "existing-browser-capability-123",
        verificationEvidence: "BS-4471-K",
      },
    });
  });

  it("returns a recoverable verification outcome without echoing evidence", async () => {
    const contextPort: ContextPort = {
      prepareEntry: async () => ({ status: "unavailable" }),
      readEntryChallenge: async () => ({ status: "unavailable" }),
      advanceEntry: async () => ({ status: "unavailable" }),
      verifyEntry: async () => ({ status: "verification-unavailable" }),
      readReviewSession: async () => ({ status: "unavailable" }),
    };
    const app = createWebBffApp({
      contextPort,
      publicOrigin: "https://reviews.example.test",
      csrfProtector: {
        issue: async () => "csrf-token-with-at-least-thirty-two-characters",
        verify: async () => true,
      },
    });
    const evidence = "PRIVATE-RECEIPT-4471";
    const body = new URLSearchParams({
      verificationEvidence: evidence,
      csrfToken: "csrf-token-with-at-least-thirty-two-characters",
    }).toString();

    const response = await app.request(
      "/api/v1/entry-challenges/entry-challenge-demo/verify",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          Cookie: "__Host-review_browser=existing-browser-capability-123",
          Origin: "https://reviews.example.test",
          "x-amz-content-sha256": await sha256Hex(body),
        },
        body,
      },
    );
    const responseText = await response.text();

    expect({
      status: response.status,
      body: JSON.parse(responseText),
      evidenceLeaked: responseText.includes(evidence),
    }).toEqual({
      status: 200,
      body: { status: "verification-unavailable" },
      evidenceLeaked: false,
    });
  });

  it("rejects unbound evidence with the same public error and no Context call", async () => {
    let verificationCalls = 0;
    const contextPort: ContextPort = {
      prepareEntry: async () => ({ status: "unavailable" }),
      readEntryChallenge: async () => ({ status: "unavailable" }),
      advanceEntry: async () => ({ status: "unavailable" }),
      verifyEntry: async () => {
        verificationCalls += 1;
        return {
          status: "admitted",
          reviewSessionHandle: "must-not-be-disclosed",
        };
      },
      readReviewSession: async () => ({ status: "unavailable" }),
    };
    const app = createWebBffApp({
      contextPort,
      publicOrigin: "https://reviews.example.test",
      newRequestId: () => "request-a",
      csrfProtector: {
        issue: async () => "csrf-token-with-at-least-thirty-two-characters",
        verify: async () => true,
      },
    });
    const evidence = "PRIVATE-RECEIPT-4471";
    const body = new URLSearchParams({
      verificationEvidence: evidence,
      csrfToken: "csrf-token-with-at-least-thirty-two-characters",
    }).toString();

    const response = await app.request(
      "/api/v1/entry-challenges/entry-challenge-demo/verify",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          Cookie: "__Host-review_browser=existing-browser-capability-123",
          Origin: "https://reviews.example.test",
          "x-amz-content-sha256": "0".repeat(64),
        },
        body,
      },
    );
    const responseText = await response.text();

    expect({
      status: response.status,
      body: JSON.parse(responseText),
      evidenceLeaked: responseText.includes(evidence),
      verificationCalls,
    }).toEqual({
      status: 404,
      body: {
        code: "ENTRY_UNAVAILABLE",
        message: "This review link is unavailable.",
        retryable: false,
        requestId: "request-a",
      },
      evidenceLeaked: false,
      verificationCalls: 0,
    });
  });
});
