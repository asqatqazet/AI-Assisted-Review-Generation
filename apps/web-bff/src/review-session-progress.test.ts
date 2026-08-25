import { describe, expect, it } from "vitest";

import { createWebBffApp } from "./app.js";
import type { ContextPort } from "./ports/context.port.js";

const browserCapability = "browser-capability-1234567890";
const origin = "https://d111111abcdef8.cloudfront.net";

const unavailableContext: ContextPort = {
  prepareEntry: async () => ({ status: "unavailable" }),
  readEntryChallenge: async () => ({ status: "unavailable" }),
  advanceEntry: async () => ({ status: "unavailable" }),
  readReviewSession: async () => ({ status: "unavailable" }),
};

async function sha256Hex(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

describe("US-02.3 Review Session progress BFF boundary", () => {
  it("binds progress to the HttpOnly browser capability and server session", async () => {
    const seen: unknown[] = [];
    const body = JSON.stringify({
      expectedEpoch: 2,
      progress: {
        phase: "format",
        selectedFactOptionIds: ["fact-attentive"],
        customerAssertion: "",
        sourceText: "",
        selectedReviewFormatId: "format-concise-v1",
      },
    });
    const app = createWebBffApp({
      publicOrigin: origin,
      contextPort: {
        ...unavailableContext,
        saveReviewSessionProgress: async (input) => {
          seen.push(input);
          return {
            status: "saved",
            progress: { epoch: 3, ...input.progress },
          };
        },
      },
    });

    const response = await app.request(
      "/api/v1/review-sessions/review-session-demo/progress",
      {
        method: "PUT",
        headers: {
          Cookie: `__Host-review_browser=${browserCapability}`,
          Origin: origin,
          "Content-Type": "application/json",
          "x-amz-content-sha256": await sha256Hex(body),
        },
        body,
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(seen).toEqual([
      {
        reviewSessionHandle: "review-session-demo",
        browserCapability,
        expectedEpoch: 2,
        progress: {
          phase: "format",
          selectedFactOptionIds: ["fact-attentive"],
          customerAssertion: "",
          sourceText: "",
          selectedReviewFormatId: "format-concise-v1",
        },
      },
    ]);
    await expect(response.json()).resolves.toMatchObject({
      status: "saved",
      progress: { epoch: 3 },
    });
  });

  it("returns the current server projection on an optimistic concurrency conflict", async () => {
    const body = JSON.stringify({
      expectedEpoch: 2,
      progress: {
        phase: "facts",
        selectedFactOptionIds: [],
        customerAssertion: "",
        sourceText: "",
        selectedReviewFormatId: null,
      },
    });
    const app = createWebBffApp({
      publicOrigin: origin,
      contextPort: {
        ...unavailableContext,
        saveReviewSessionProgress: async () => ({
          status: "conflict",
          progress: {
            epoch: 5,
            phase: "format",
            selectedFactOptionIds: ["server-fact"],
            customerAssertion: "",
            sourceText: "",
            selectedReviewFormatId: null,
          },
        }),
      },
    });

    const response = await app.request(
      "/api/v1/review-sessions/review-session-demo/progress",
      {
        method: "PUT",
        headers: {
          Cookie: `__Host-review_browser=${browserCapability}`,
          Origin: origin,
          "Content-Type": "application/json",
          "x-amz-content-sha256": await sha256Hex(body),
        },
        body,
      },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      status: "conflict",
      progress: { epoch: 5, selectedFactOptionIds: ["server-fact"] },
    });
  });

  it("does not reveal whether a Review Session exists when authority is missing", async () => {
    const app = createWebBffApp({
      publicOrigin: origin,
      contextPort: unavailableContext,
    });

    const response = await app.request(
      "/api/v1/review-sessions/review-session-demo/progress",
      { method: "PUT", headers: { Origin: origin }, body: "{}" },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: "REVIEW_SESSION_UNAVAILABLE",
    });
  });
});
