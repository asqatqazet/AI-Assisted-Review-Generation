import { describe, expect, it } from "vitest";

import { createWebBffApp } from "./app.js";
import type { ContextPort } from "./ports/context.port.js";

describe("reviewer entry preparation", () => {
  it("redirects a prepared link without exposing its Invitation Token", async () => {
    const contextPort: ContextPort = {
      prepareEntry: async () => ({
        status: "prepared",
        entryChallengeHandle: "entry-challenge-demo",
      }),
      readEntryChallenge: async () => ({ status: "unavailable" }),
      advanceEntry: async () => ({ status: "unavailable" }),
      readReviewSession: async () => ({ status: "unavailable" }),
    };
    const app = createWebBffApp({
      contextPort,
      newBrowserCapability: () => "opaque-browser-capability",
    });

    const response = await app.request(
      "/s/apex-dental/central?v=secret-invitation-token&t=Chair-2",
      { headers: { Accept: "text/html" } },
    );
    const body = await response.text();

    expect({
      status: response.status,
      location: response.headers.get("location"),
      cookie: response.headers.get("set-cookie"),
      leakedToken: `${response.headers.get("location") ?? ""}${body}`.includes(
        "secret-invitation-token",
      ),
    }).toEqual({
      status: 303,
      location: "/start/entry-challenge-demo",
      cookie:
        "__Host-review_browser=opaque-browser-capability; Max-Age=86400; Path=/; HttpOnly; Secure; SameSite=Lax",
      leakedToken: false,
    });
  });

  it("reuses one browser capability across separate reviewer links", async () => {
    const contextPort: ContextPort = {
      prepareEntry: async (input) =>
        input.browserCapability === "existing-browser-capability-123"
          ? { status: "prepared", entryChallengeHandle: "second-challenge" }
          : { status: "unavailable" },
      readEntryChallenge: async () => ({ status: "unavailable" }),
      advanceEntry: async () => ({ status: "unavailable" }),
      readReviewSession: async () => ({ status: "unavailable" }),
    };
    const app = createWebBffApp({
      contextPort,
      newBrowserCapability: () => "unexpected-replacement-capability",
    });

    const response = await app.request("/s/lumina-optics/flagship?v=second-token", {
      headers: {
        Cookie: "__Host-review_browser=existing-browser-capability-123",
      },
    });

    expect({
      status: response.status,
      location: response.headers.get("location"),
      replacementCookie: response.headers.get("set-cookie"),
    }).toEqual({
      status: 303,
      location: "/start/second-challenge",
      replacementCookie: null,
    });
  });

  it("returns a browser-bound public Entry Challenge projection", async () => {
    const contextPort: ContextPort = {
      prepareEntry: async () => ({ status: "unavailable" }),
      readEntryChallenge: async (input) =>
        input.browserCapability === "existing-browser-capability-123" &&
        input.entryChallengeHandle === "entry-challenge-demo"
          ? {
              status: "ready",
              context: {
                tenantDisplayName: "Apex Dental",
                locationDisplayName: "Central Clinic",
                locale: "en-GB",
                entryMode: "invite",
                ratingRequired: true,
                requirements: {
                  minimumFactSelections: 1,
                  maximumReviewFormatsPerGeneration: 1,
                },
                factOptions: [],
                reviewFormats: [],
                destinations: [],
              },
            }
          : { status: "unavailable" },
      advanceEntry: async () => ({ status: "unavailable" }),
      readReviewSession: async () => ({ status: "unavailable" }),
    };
    const app = createWebBffApp({
      contextPort,
      csrfProtector: {
        issue: async () => "csrf-token-with-at-least-thirty-two-characters",
        verify: async () => false,
      },
    });

    const response = await app.request(
      "/api/v1/entry-challenges/entry-challenge-demo",
      {
        headers: {
          Cookie: "__Host-review_browser=existing-browser-capability-123",
        },
      },
    );
    const responseText = await response.text();
    const responseBody: unknown = response.headers
      .get("content-type")
      ?.includes("application/json")
      ? JSON.parse(responseText)
      : responseText;

    expect({
      status: response.status,
      cacheControl: response.headers.get("cache-control"),
      body: responseBody,
    }).toEqual({
      status: 200,
      cacheControl: "private, no-store",
      body: {
        status: "ready",
        entryChallengeHandle: "entry-challenge-demo",
        csrfToken: "csrf-token-with-at-least-thirty-two-characters",
        context: {
          tenantDisplayName: "Apex Dental",
          locationDisplayName: "Central Clinic",
          locale: "en-GB",
          entryMode: "invite",
          ratingRequired: true,
          requirements: {
            minimumFactSelections: 1,
            maximumReviewFormatsPerGeneration: 1,
          },
          factOptions: [],
          reviewFormats: [],
          destinations: [],
        },
      },
    });
  });
});
