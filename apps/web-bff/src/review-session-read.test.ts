import { describe, expect, it } from "vitest";

import { createWebBffApp } from "./app.js";

describe("US-01.3 Review Session BFF projection", () => {
  it("reads a browser-bound Review Session without exposing cacheable state", async () => {
    let received: unknown;
    const app = createWebBffApp({
      contextPort: {
        prepareEntry: async () => ({ status: "unavailable" }),
        readEntryChallenge: async () => ({ status: "unavailable" }),
        advanceEntry: async () => ({ status: "unavailable" }),
        readReviewSession: async (input) => {
          received = input;
          return {
            status: "ready",
            reviewSessionHandle: "review-session-demo",
            tenantDisplayName: "Apex Dental",
            locationDisplayName: "Central Clinic",
            locale: "en-GB",
            rating: 4,
            action: "generate",
            requirements: {
              minimumFactSelections: 1,
              maximumReviewFormatsPerGeneration: 1,
            },
            factOptions: [
              {
                id: "fact-attentive",
                label: "The team was attentive",
                categoryLabel: "Service",
                polarity: "positive",
              },
            ],
            reviewFormats: [],
            destinations: [],
          };
        },
      },
    });

    const response = await app.request(
      "/api/v1/review-sessions/review-session-demo",
      {
        headers: {
          Cookie:
            "__Host-review_browser=browser-capability-with-enough-entropy",
        },
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({
      status: "ready",
      reviewSessionHandle: "review-session-demo",
      rating: 4,
    });
    expect(received).toEqual({
      reviewSessionHandle: "review-session-demo",
      browserCapability: "browser-capability-with-enough-entropy",
    });
  });
});
