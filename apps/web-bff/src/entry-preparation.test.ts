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
});
