import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import { createCognitoOperatorAuth } from "./cognito-operator-auth.js";

describe("US-04.1 Cognito OIDC adapter", () => {
  it("creates a standards-based authorization request with PKCE, state, and nonce", async () => {
    const auth = createCognitoOperatorAuth({
      authorizationEndpoint:
        "https://review.auth.eu-central-1.amazoncognito.com/oauth2/authorize",
      tokenEndpoint:
        "https://review.auth.eu-central-1.amazoncognito.com/oauth2/token",
      issuer:
        "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_pool",
      jwksUri:
        "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_pool/.well-known/jwks.json",
      clientId: "client-123",
      redirectUri: "https://d111.cloudfront.net/auth/callback",
      sessionSecret: "0123456789abcdef0123456789abcdef",
      newState: () => "state-123",
      newNonce: () => "nonce-123",
      newCodeVerifier: () =>
        "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
      now: () => new Date("2026-08-18T12:00:00.000Z"),
      fetch: async () => new Response(null, { status: 500 }),
    });

    const result = await auth.begin({ returnTo: "/console" });
    const url = new URL(result.authorizationUrl);

    expect(url.origin + url.pathname).toBe(
      "https://review.auth.eu-central-1.amazoncognito.com/oauth2/authorize",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "client-123",
      redirect_uri: "https://d111.cloudfront.net/auth/callback",
      response_type: "code",
      scope: "openid email profile",
      state: "state-123",
      nonce: "nonce-123",
      code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      code_challenge_method: "S256",
    });
    expect(result.transactionCookie).toMatch(/^[A-Za-z0-9_.-]+$/);
    expect(result.transactionCookie).not.toContain("state-123");
  });

  it("validates the Cognito ID token and keeps provider tokens out of the browser session", async () => {
    const issuer =
      "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_pool";
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const publicJwk = await exportJWK(publicKey);
    const now = new Date("2026-08-18T12:00:00.000Z");
    const issuedAt = Math.floor(now.getTime() / 1000);
    const idToken = await new SignJWT({
      email: "owner@example.com",
      email_verified: true,
      nonce: "nonce-123",
      token_use: "id",
    })
      .setProtectedHeader({ alg: "RS256", kid: "key-1" })
      .setIssuer(issuer)
      .setAudience("client-123")
      .setSubject("cognito-subject-123")
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + 300)
      .sign(privateKey);
    let tokenRequestBody = "";
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const method = init?.method ?? "GET";
      if (method === "POST") {
        tokenRequestBody = String(init?.body ?? "");
        return Response.json({
          access_token: "provider-access-token",
          id_token: idToken,
          token_type: "Bearer",
          expires_in: 3600,
        });
      }
      expect(String(input)).toBe(`${issuer}/.well-known/jwks.json`);
      return Response.json({
        keys: [{ ...publicJwk, kid: "key-1", alg: "RS256", use: "sig" }],
      });
    };
    const auth = createCognitoOperatorAuth({
      authorizationEndpoint: "https://review.auth.example/oauth2/authorize",
      tokenEndpoint: "https://review.auth.example/oauth2/token",
      issuer,
      jwksUri: `${issuer}/.well-known/jwks.json`,
      clientId: "client-123",
      redirectUri: "https://d111.cloudfront.net/auth/callback",
      sessionSecret: "0123456789abcdef0123456789abcdef",
      newState: () => "state-123",
      newNonce: () => "nonce-123",
      newCodeVerifier: () =>
        "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
      now: () => now,
      fetch,
    });
    const login = await auth.begin({ returnTo: "/console/overview" });

    const completed = await auth.complete({
      code: "one-time-code",
      state: "state-123",
      transactionCookie: login.transactionCookie,
    });

    expect(new URLSearchParams(tokenRequestBody)).toEqual(
      new URLSearchParams({
        grant_type: "authorization_code",
        client_id: "client-123",
        redirect_uri: "https://d111.cloudfront.net/auth/callback",
        code: "one-time-code",
        code_verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
      }),
    );
    expect(completed.returnTo).toBe("/console/overview");
    expect(completed.sessionCookie).not.toContain("provider-access-token");
    await expect(
      auth.readSession({ sessionCookie: completed.sessionCookie }),
    ).resolves.toEqual({
      issuer,
      subject: "cognito-subject-123",
      email: "owner@example.com",
    });

    const replacementPoolAuth = createCognitoOperatorAuth({
      authorizationEndpoint: "https://replacement.auth.example/oauth2/authorize",
      tokenEndpoint: "https://replacement.auth.example/oauth2/token",
      issuer:
        "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_replacement",
      jwksUri:
        "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_replacement/.well-known/jwks.json",
      clientId: "replacement-client",
      redirectUri: "https://d111.cloudfront.net/auth/callback",
      sessionSecret: "0123456789abcdef0123456789abcdef",
      now: () => now,
      fetch: async () => new Response(null, { status: 500 }),
    });
    await expect(
      replacementPoolAuth.readSession({
        sessionCookie: completed.sessionCookie,
      }),
    ).resolves.toBeNull();
  });
});
