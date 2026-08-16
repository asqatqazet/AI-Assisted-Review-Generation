import { describe, expect, it } from "vitest";

import { createHmacCsrfProtector } from "./csrf-protector.js";

describe("browser-bound CSRF protection", () => {
  it("rejects a validly signed token at its exact server-time expiry", async () => {
    let now = 1_000;
    const protector = createHmacCsrfProtector(
      "test-secret-that-is-longer-than-thirty-two-bytes",
      { now: () => now, lifetimeMs: 1_000 },
    );
    const binding = {
      entryChallengeHandle: "entry-challenge-demo",
      browserCapability: "existing-browser-capability-123",
    };
    const token = await protector.issue(binding);

    expect(await protector.verify({ ...binding, token })).toBe(true);

    now = 2_000;
    expect(await protector.verify({ ...binding, token })).toBe(false);
  });
});
