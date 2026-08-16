import { describe, expect, it } from "vitest";

import { createWebBffApp } from "./app.js";

describe("retired prototype routes", () => {
  it("does not expose the browser-trusted legacy generation endpoint", async () => {
    const app = createWebBffApp();

    const response = await app.request("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId: "attacker-selected-tenant",
        locationId: "attacker-selected-location",
        action: "generate",
        reviewFormatKey: "short",
        assertions: [{ text: "Unverified browser prose" }],
      }),
    });

    expect(response.status).toBe(404);
  });
});
