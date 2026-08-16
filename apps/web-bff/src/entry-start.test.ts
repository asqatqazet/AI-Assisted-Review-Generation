import { describe, expect, it } from "vitest";

import { createWebBffApp } from "./app.js";
import type { AdvanceEntryInput, ContextPort } from "./ports/context.port.js";

describe("reviewer entry admission", () => {
  it("redirects an admitted browser-bound Entry Challenge to its Review Session", async () => {
    let received: AdvanceEntryInput | undefined;
    const contextPort: ContextPort = {
      prepareEntry: async () => ({ status: "unavailable" }),
      readEntryChallenge: async () => ({ status: "unavailable" }),
      advanceEntry: async (input) => {
        received = input;
        return {
          status: "admitted",
          reviewSessionHandle: "review-session-demo",
        };
      },
    };
    const app = createWebBffApp({ contextPort });

    const response = await app.request(
      "/api/v1/entry-challenges/entry-challenge-demo/start",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: "__Host-review_browser=existing-browser-capability-123",
          Origin: "http://localhost",
        },
        body: JSON.stringify({
          rating: 4,
          action: "generate",
          csrfToken: "csrf-token-with-at-least-thirty-two-characters",
        }),
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
        rating: 4,
        action: "generate",
      },
    });
  });

  it("rejects a CSRF token that is not bound to this browser and Entry Challenge", async () => {
    let advanceCalls = 0;
    const contextPort: ContextPort = {
      prepareEntry: async () => ({ status: "unavailable" }),
      readEntryChallenge: async () => ({ status: "unavailable" }),
      advanceEntry: async () => {
        advanceCalls += 1;
        return {
          status: "admitted",
          reviewSessionHandle: "must-not-be-disclosed",
        };
      },
    };
    const app = createWebBffApp({
      contextPort,
      csrfProtector: {
        issue: async () => "issued-token-with-at-least-thirty-two-characters",
        verify: async () => false,
      },
    });

    const response = await app.request(
      "/api/v1/entry-challenges/entry-challenge-demo/start",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: "__Host-review_browser=existing-browser-capability-123",
          Origin: "http://localhost",
        },
        body: JSON.stringify({
          rating: 4,
          action: "generate",
          csrfToken: "wrong-token-with-at-least-thirty-two-characters",
        }),
      },
    );

    const responseText = await response.text();

    expect({
      status: response.status,
      body: responseText === "" ? null : JSON.parse(responseText),
      advanceCalls,
    }).toEqual({
      status: 404,
      body: {
        code: "ENTRY_UNAVAILABLE",
        message: "This review link is unavailable.",
      },
      advanceCalls: 0,
    });
  });
});
