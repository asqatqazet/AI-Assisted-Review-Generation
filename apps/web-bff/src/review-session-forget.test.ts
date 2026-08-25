import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { createWebBffApp } from "./app.js";
import type { ContextPort } from "./ports/context.port.js";

const emptyBodyHash = createHash("sha256").update("").digest("hex");

describe("US-02.3 Forget this review BFF", () => {
  it("revokes only the selected browser-bound Review Session", async () => {
    let received: unknown;
    const contextPort: ContextPort = {
      prepareEntry: async () => ({ status: "unavailable" }),
      readEntryChallenge: async () => ({ status: "unavailable" }),
      advanceEntry: async () => ({ status: "unavailable" }),
      verifyEntry: async () => ({ status: "unavailable" }),
      readReviewSession: async () => ({ status: "unavailable" }),
      forgetReviewSession: async (input) => {
        received = input;
        return { status: "forgotten" };
      },
    };
    const app = createWebBffApp({
      contextPort,
      publicOrigin: "https://reviews.example.test",
    });

    const response = await app.request(
      "/api/v1/review-sessions/review-session-handle",
      {
        method: "DELETE",
        headers: {
          Origin: "https://reviews.example.test",
          Cookie: "__Host-review_browser=browser-capability-123456789",
          "x-amz-content-sha256": emptyBodyHash,
        },
      },
    );

    expect(response.status).toBe(204);
    expect(received).toEqual({
      reviewSessionHandle: "review-session-handle",
      browserCapability: "browser-capability-123456789",
    });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Set-Cookie")).toBeNull();
  });

  it("does not reveal or revoke a Review Session cross-origin", async () => {
    let called = false;
    const contextPort: ContextPort = {
      prepareEntry: async () => ({ status: "unavailable" }),
      readEntryChallenge: async () => ({ status: "unavailable" }),
      advanceEntry: async () => ({ status: "unavailable" }),
      verifyEntry: async () => ({ status: "unavailable" }),
      readReviewSession: async () => ({ status: "unavailable" }),
      forgetReviewSession: async () => {
        called = true;
        return { status: "forgotten" };
      },
    };
    const app = createWebBffApp({
      contextPort,
      publicOrigin: "https://reviews.example.test",
      newRequestId: () => "request-forget-a",
    });
    const response = await app.request(
      "/api/v1/review-sessions/review-session-handle",
      {
        method: "DELETE",
        headers: {
          Origin: "https://attacker.example",
          Cookie: "__Host-review_browser=browser-capability-123456789",
          "x-amz-content-sha256": emptyBodyHash,
        },
      },
    );
    expect(response.status).toBe(404);
    expect(called).toBe(false);
    expect(await response.json()).toEqual({
      code: "REVIEW_SESSION_UNAVAILABLE",
      message: "This review is unavailable.",
      retryable: false,
      requestId: "request-forget-a",
    });
  });

  it("rejects a DELETE payload instead of accepting hidden caller scope", async () => {
    let called = false;
    const contextPort: ContextPort = {
      prepareEntry: async () => ({ status: "unavailable" }),
      readEntryChallenge: async () => ({ status: "unavailable" }),
      advanceEntry: async () => ({ status: "unavailable" }),
      readReviewSession: async () => ({ status: "unavailable" }),
      forgetReviewSession: async () => {
        called = true;
        return { status: "forgotten" };
      },
    };
    const app = createWebBffApp({
      contextPort,
      publicOrigin: "https://reviews.example.test",
    });
    const response = await app.request(
      "/api/v1/review-sessions/review-session-handle",
      {
        method: "DELETE",
        headers: {
          Origin: "https://reviews.example.test",
          Cookie: "__Host-review_browser=browser-capability-123456789",
          "Content-Type": "application/json",
          "x-amz-content-sha256": emptyBodyHash,
        },
        body: JSON.stringify({ tenantId: "another-tenant" }),
      },
    );

    expect(response.status).toBe(404);
    expect(called).toBe(false);
  });
});
