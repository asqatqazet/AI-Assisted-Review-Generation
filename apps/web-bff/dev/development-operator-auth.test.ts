import { describe, expect, it } from "vitest";

import { createDevelopmentOperatorAuth } from "./development-operator-auth.js";

describe("local-only Operator authentication", () => {
  it("completes the BFF redirect flow as the selected deterministic operator", async () => {
    const auth = createDevelopmentOperatorAuth({
      publicOrigin: "http://127.0.0.1:5173",
      signingSecret: "local-test-secret-with-at-least-32-characters",
      credentials: {
        platform: "random-platform-credential-longer-than-32-characters",
        tenant: "random-tenant-credential-longer-than-32-characters",
      },
      operators: {
        platform: {
          issuer: "https://local.review.invalid",
          subject: "local-platform-operator",
          email: "platform@local.review.invalid",
        },
        tenant: {
          issuer: "https://local.review.invalid",
          subject: "local-tenant-operator",
          email: "tenant@local.review.invalid",
        },
      },
    });

    const login = await auth.begin({
      returnTo:
        "/console?localCredential=random-tenant-credential-longer-than-32-characters",
    });
    const callback = new URL(login.authorizationUrl);
    const completed = await auth.complete({
      code: callback.searchParams.get("code")!,
      state: callback.searchParams.get("state")!,
      transactionCookie: login.transactionCookie,
    });

    expect(completed.returnTo).toBe("/console");
    await expect(
      auth.readSession({ sessionCookie: completed.sessionCookie }),
    ).resolves.toEqual({
      identity: {
        issuer: "https://local.review.invalid",
        subject: "local-tenant-operator",
        email: "tenant@local.review.invalid",
      },
      refreshedSessionCookie: null,
    });
  });

  it("rejects an unknown credential without choosing a default persona", async () => {
    const auth = createDevelopmentOperatorAuth({
      publicOrigin: "http://127.0.0.1:5173",
      signingSecret: "local-test-secret-with-at-least-32-characters",
      credentials: {
        platform: "random-platform-credential-longer-than-32-characters",
        tenant: "random-tenant-credential-longer-than-32-characters",
      },
      operators: {
        platform: {
          issuer: "https://local.review.invalid/run-a",
          subject: "opaque-platform-subject",
          email: "platform@local.review.invalid",
        },
        tenant: {
          issuer: "https://local.review.invalid/run-a",
          subject: "opaque-tenant-subject",
          email: "tenant@local.review.invalid",
        },
      },
    });

    await expect(
      auth.begin({ returnTo: "/console?localCredential=wrong" }),
    ).rejects.toThrow("development OperatorAuth credential is invalid");
  });
});
