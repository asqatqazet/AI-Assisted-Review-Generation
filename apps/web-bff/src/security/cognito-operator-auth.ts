import {
  createRemoteJWKSet,
  customFetch,
  EncryptJWT,
  jwtDecrypt,
  jwtVerify,
} from "jose";

import type { OperatorAuthPort } from "../ports/operator-auth.port.js";

interface CognitoOperatorAuthOptions {
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly issuer: string;
  readonly jwksUri: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly sessionSecret: string;
  readonly newState?: (() => string) | undefined;
  readonly newNonce?: (() => string) | undefined;
  readonly newCodeVerifier?: (() => string) | undefined;
  readonly now?: (() => Date) | undefined;
  readonly fetch?: typeof globalThis.fetch | undefined;
}

const encoder = new TextEncoder();
const SESSION_TTL_SECONDS = 24 * 60 * 60;
const REFRESH_AHEAD_SECONDS = 5 * 60;

function randomBase64Url(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    encoder.encode(value),
  );
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

async function encryptionKey(secret: string): Promise<Uint8Array> {
  if (encoder.encode(secret).byteLength < 32) {
    throw new Error("OPERATOR_SESSION_SECRET must contain at least 32 bytes");
  }
  return new Uint8Array(
    await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(secret)),
  );
}

export function createCognitoOperatorAuth(
  options: CognitoOperatorAuthOptions,
): OperatorAuthPort {
  const state = options.newState ?? randomBase64Url;
  const nonce = options.newNonce ?? randomBase64Url;
  const codeVerifier = options.newCodeVerifier ?? randomBase64Url;
  const now = options.now ?? (() => new Date());
  const fetch = options.fetch ?? globalThis.fetch;
  const key = encryptionKey(options.sessionSecret);
  const remoteKeySet = createRemoteJWKSet(new URL(options.jwksUri), {
    [customFetch]: async (url, init) =>
      await fetch(url, {
        ...init,
        headers: init.headers,
      }),
  });
  const logoutUri = new URL("/console", options.redirectUri).toString();
  const logoutEndpoint = new URL("/logout", options.authorizationEndpoint);
  const revocationEndpoint = new URL("/oauth2/revoke", options.tokenEndpoint);

  const identityClaims = async (
    idToken: string,
    currentDate: Date,
    expected: {
      readonly nonce?: string | undefined;
      readonly subject?: string | undefined;
      readonly email?: string | undefined;
    } = {},
  ) => {
    const verified = await jwtVerify(idToken, remoteKeySet, {
      issuer: options.issuer,
      audience: options.clientId,
      algorithms: ["RS256"],
      currentDate,
    });
    const claims = verified.payload;
    const email =
      typeof claims["email"] === "string"
        ? claims["email"].toLowerCase()
        : null;
    if (
      claims["token_use"] !== "id" ||
      (expected.nonce !== undefined && claims["nonce"] !== expected.nonce) ||
      typeof claims.sub !== "string" ||
      email === null ||
      claims["email_verified"] !== true ||
      typeof claims.exp !== "number" ||
      (expected.subject !== undefined && claims.sub !== expected.subject) ||
      (expected.email !== undefined && email !== expected.email)
    ) {
      throw new Error("OIDC identity claims are invalid");
    }
    return {
      issuer: options.issuer,
      subject: claims.sub,
      email,
      providerExpiresAt: claims.exp,
    };
  };

  const sealSession = async ({
    identity,
    refreshToken,
    providerExpiresAt,
    sessionExpiresAt,
    currentDate,
  }: {
    readonly identity: {
      readonly issuer: string;
      readonly subject: string;
      readonly email: string;
    };
    readonly refreshToken: string;
    readonly providerExpiresAt: number;
    readonly sessionExpiresAt: number;
    readonly currentDate: Date;
  }): Promise<string> =>
    await new EncryptJWT({
      purpose: "operator-session",
      issuer: identity.issuer,
      subject: identity.subject,
      email: identity.email,
      refreshToken,
      providerExpiresAt,
    })
      .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
      .setIssuedAt(Math.floor(currentDate.getTime() / 1000))
      .setExpirationTime(sessionExpiresAt)
      .encrypt(await key);

  return {
    async begin({ returnTo }) {
      const transactionState = state();
      const transactionNonce = nonce();
      const verifier = codeVerifier();
      const issuedAt = Math.floor(now().getTime() / 1000);
      const transactionCookie = await new EncryptJWT({
        purpose: "operator-oidc-transaction",
        state: transactionState,
        nonce: transactionNonce,
        codeVerifier: verifier,
        returnTo,
      })
        .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
        .setIssuedAt(issuedAt)
        .setExpirationTime(issuedAt + 600)
        .encrypt(await key);

      const authorizationUrl = new URL(options.authorizationEndpoint);
      authorizationUrl.search = new URLSearchParams({
        client_id: options.clientId,
        redirect_uri: options.redirectUri,
        response_type: "code",
        scope: "openid email profile",
        state: transactionState,
        nonce: transactionNonce,
        code_challenge: await sha256Base64Url(verifier),
        code_challenge_method: "S256",
      }).toString();

      return {
        authorizationUrl: authorizationUrl.toString(),
        transactionCookie,
      };
    },

    async complete({ code, state: returnedState, transactionCookie }) {
      const currentDate = now();
      const { payload: transaction } = await jwtDecrypt(
        transactionCookie,
        await key,
        { currentDate, keyManagementAlgorithms: ["dir"], contentEncryptionAlgorithms: ["A256GCM"] },
      );
      if (
        transaction["purpose"] !== "operator-oidc-transaction" ||
        transaction["state"] !== returnedState ||
        typeof transaction["nonce"] !== "string" ||
        typeof transaction["codeVerifier"] !== "string" ||
        typeof transaction["returnTo"] !== "string" ||
        !transaction["returnTo"].startsWith("/console") ||
        transaction["returnTo"].startsWith("//")
      ) {
        throw new Error("OIDC transaction is invalid");
      }

      const tokenResponse = await fetch(options.tokenEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: options.clientId,
          redirect_uri: options.redirectUri,
          code,
          code_verifier: transaction["codeVerifier"],
        }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!tokenResponse.ok) {
        throw new Error("OIDC token exchange failed");
      }
      const tokenPayload = (await tokenResponse.json()) as unknown;
      if (
        typeof tokenPayload !== "object" ||
        tokenPayload === null ||
        !("id_token" in tokenPayload) ||
        typeof tokenPayload.id_token !== "string" ||
        !("refresh_token" in tokenPayload) ||
        typeof tokenPayload.refresh_token !== "string" ||
        tokenPayload.refresh_token.length === 0
      ) {
        throw new Error("OIDC token response is invalid");
      }
      const identity = await identityClaims(tokenPayload.id_token, currentDate, {
        nonce: transaction["nonce"],
      });
      const issuedAt = Math.floor(currentDate.getTime() / 1000);
      const sessionCookie = await sealSession({
        identity,
        refreshToken: tokenPayload.refresh_token,
        providerExpiresAt: identity.providerExpiresAt,
        sessionExpiresAt: issuedAt + SESSION_TTL_SECONDS,
        currentDate,
      });

      return { sessionCookie, returnTo: transaction["returnTo"] };
    },

    async readSession({ sessionCookie }) {
      try {
        const currentDate = now();
        const { payload } = await jwtDecrypt(sessionCookie, await key, {
          currentDate,
          keyManagementAlgorithms: ["dir"],
          contentEncryptionAlgorithms: ["A256GCM"],
        });
        if (
          payload["purpose"] !== "operator-session" ||
          payload["issuer"] !== options.issuer ||
          typeof payload["subject"] !== "string" ||
          typeof payload["email"] !== "string" ||
          typeof payload["refreshToken"] !== "string" ||
          typeof payload["providerExpiresAt"] !== "number" ||
          typeof payload.exp !== "number"
        ) {
          return null;
        }
        const identity = {
          issuer: payload["issuer"],
          subject: payload["subject"],
          email: payload["email"],
        };
        const nowSeconds = Math.floor(currentDate.getTime() / 1000);
        if (payload["providerExpiresAt"] - nowSeconds > REFRESH_AHEAD_SECONDS) {
          return { identity, refreshedSessionCookie: null };
        }

        const tokenResponse = await fetch(options.tokenEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            client_id: options.clientId,
            refresh_token: payload["refreshToken"],
          }),
          signal: AbortSignal.timeout(5_000),
        });
        if (!tokenResponse.ok) {
          return payload["providerExpiresAt"] > nowSeconds
            ? { identity, refreshedSessionCookie: null }
            : null;
        }
        const tokenPayload = (await tokenResponse.json()) as unknown;
        if (
          typeof tokenPayload !== "object" ||
          tokenPayload === null ||
          !("id_token" in tokenPayload) ||
          typeof tokenPayload.id_token !== "string"
        ) {
          return null;
        }
        const refreshedIdentity = await identityClaims(
          tokenPayload.id_token,
          currentDate,
          { subject: identity.subject, email: identity.email },
        );
        const rotatedRefreshToken =
          "refresh_token" in tokenPayload &&
          typeof tokenPayload.refresh_token === "string" &&
          tokenPayload.refresh_token.length > 0
            ? tokenPayload.refresh_token
            : payload["refreshToken"];
        return {
          identity,
          refreshedSessionCookie: await sealSession({
            identity: refreshedIdentity,
            refreshToken: rotatedRefreshToken,
            providerExpiresAt: refreshedIdentity.providerExpiresAt,
            sessionExpiresAt: payload.exp,
            currentDate,
          }),
        };
      } catch {
        return null;
      }
    },

    async logout({ sessionCookie }) {
      try {
        const { payload } = await jwtDecrypt(sessionCookie, await key, {
          currentDate: now(),
          keyManagementAlgorithms: ["dir"],
          contentEncryptionAlgorithms: ["A256GCM"],
        });
        if (
          payload["purpose"] === "operator-session" &&
          payload["issuer"] === options.issuer &&
          typeof payload["refreshToken"] === "string"
        ) {
          const response = await fetch(revocationEndpoint, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              token: payload["refreshToken"],
              client_id: options.clientId,
            }),
            signal: AbortSignal.timeout(5_000),
          });
          if (!response.ok) {
            throw new Error("OIDC token revocation failed");
          }
        }
      } catch {
        // No trustworthy provider token can be recovered from an invalid or
        // expired local cookie, and a transient revoke failure must not block
        // browser SSO logout. The BFF has already expired its local cookie.
      }
      logoutEndpoint.search = new URLSearchParams({
        client_id: options.clientId,
        logout_uri: logoutUri,
      }).toString();
      return { logoutUrl: logoutEndpoint.toString() };
    },
  };
}
