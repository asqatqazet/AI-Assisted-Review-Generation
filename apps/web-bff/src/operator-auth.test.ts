import { describe, expect, it } from "vitest";

import { createWebBffApp } from "./app.js";

describe("US-04.1 operator authentication", () => {
  it("starts an OIDC Authorization Code + PKCE login without exposing transaction state to JavaScript", async () => {
    const options = {
      operatorAuth: {
        begin: async () => ({
          authorizationUrl:
            "https://review-operators.auth.eu-central-1.amazoncognito.com/oauth2/authorize?client_id=client-123",
          transactionCookie: "signed-oidc-transaction",
        }),
        complete: async () => ({
          sessionCookie: "unused",
          returnTo: "/console",
        }),
        readSession: async () => null,
      },
    };
    const app = createWebBffApp(options);

    const response = await app.request("/auth/login?returnTo=%2Fconsole");

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(
      "https://review-operators.auth.eu-central-1.amazoncognito.com/oauth2/authorize?client_id=client-123",
    );
    expect(response.headers.get("Set-Cookie")).toBe(
      "__Host-operator_oidc=signed-oidc-transaction; Max-Age=600; Path=/; HttpOnly; Secure; SameSite=Lax",
    );
  });

  it("exchanges the callback server-side and establishes an HttpOnly operator session", async () => {
    let received: unknown;
    const options = {
      operatorAuth: {
        begin: async () => ({
          authorizationUrl: "https://example.invalid/oauth2/authorize",
          transactionCookie: "unused",
        }),
        complete: async (input: unknown) => {
          received = input;
          return {
            sessionCookie: "signed-operator-session",
            returnTo: "/console/overview",
          };
        },
        readSession: async () => null,
      },
    };
    const app = createWebBffApp(options);

    const response = await app.request(
      "/auth/callback?code=one-time-code&state=opaque-state",
      { headers: { Cookie: "__Host-operator_oidc=signed-oidc-transaction" } },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/console/overview");
    expect(response.headers.get("Set-Cookie")).toContain(
      "__Host-operator_session=signed-operator-session; Max-Age=3600; Path=/; HttpOnly; Secure; SameSite=Lax",
    );
    expect(response.headers.get("Set-Cookie")).toContain(
      "__Host-operator_oidc=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax",
    );
    expect(received).toEqual({
      code: "one-time-code",
      state: "opaque-state",
      transactionCookie: "signed-oidc-transaction",
    });
  });

  it("rejects a failed OIDC callback generically and expires the transaction cookie", async () => {
    const app = createWebBffApp({
      operatorAuth: {
        begin: async () => ({
          authorizationUrl: "https://example.invalid/oauth2/authorize",
          transactionCookie: "unused",
        }),
        complete: async () => {
          throw new Error("state mismatch for subject attacker-subject");
        },
        readSession: async () => null,
      },
    });

    const response = await app.request(
      "/auth/callback?code=one-time-code&state=tampered",
      { headers: { Cookie: "__Host-operator_oidc=signed-transaction" } },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "OPERATOR_AUTH_FAILED",
      message: "Sign in could not be completed.",
      retryable: false,
    });
    expect(response.headers.get("Set-Cookie")).toBe(
      "__Host-operator_oidc=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax",
    );
  });

  it("returns only Context-resolved grants for the authenticated operator session", async () => {
    let receivedIdentity: unknown;
    const operatorAuth = {
      begin: async () => ({
        authorizationUrl: "https://example.invalid/oauth2/authorize",
        transactionCookie: "unused",
      }),
      complete: async () => ({ sessionCookie: "unused", returnTo: "/console" }),
      readSession: async () => ({
        issuer:
          "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_pool",
        subject: "cognito-subject-123",
        email: "owner@example.com",
      }),
    };
    const options = {
      operatorAuth,
      operatorContextPort: {
        resolveAccess: async (identity: unknown) => {
          receivedIdentity = identity;
          return {
            status: "authorized" as const,
            operator: {
              id: "00000000-0000-4000-8000-000000000301",
              email: "owner@example.com",
            },
            platformGrants: [],
            tenantGrants: [
              {
                tenantId: "00000000-0000-4000-8000-000000000101",
                tenantSlug: "speicher-neun",
                tenantName: "Speicher Neun",
                roleKey: "tenant_admin",
                capabilities: ["console:read", "tenant:configure"],
                locations: [],
              },
            ],
          };
        },
      },
    };
    const app = createWebBffApp(options);

    const response = await app.request(
      "/api/v1/console/session?tenantId=attacker-selected",
      { headers: { Cookie: "__Host-operator_session=signed-session" } },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "authorized",
      operator: { email: "owner@example.com" },
      tenantGrants: [
        { tenantSlug: "speicher-neun", roleKey: "tenant_admin" },
      ],
    });
    expect(receivedIdentity).toEqual({
      issuer:
        "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_pool",
      subject: "cognito-subject-123",
      email: "owner@example.com",
    });
  });

  it("signs out only from the same public origin and clears the operator cookie", async () => {
    const app = createWebBffApp({ publicOrigin: "https://d111.cloudfront.net" });

    const response = await app.request("/auth/logout", {
      method: "POST",
      headers: {
        Origin: "https://d111.cloudfront.net",
        Cookie: "__Host-operator_session=signed-session",
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("Set-Cookie")).toBe(
      "__Host-operator_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax",
    );
  });
});
