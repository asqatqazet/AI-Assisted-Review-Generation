import { createPublicKey, verify as verifyBytes, type KeyObject } from "node:crypto";

export const CONSOLE_READ_AUDIENCE = "console-read";

export type ConsoleReadVerification =
  | { readonly status: "rejected" }
  | {
      readonly status: "verified";
      readonly authorizationId: string;
      readonly view: "overview" | "analytics" | "generation-detail";
      readonly readMode: "redacted" | "audit";
    };

/**
 * The execution plane holds no Access Grants, so it accepts a scope only when
 * Context has signed it, the receipt has not expired, and the scope and query
 * inside the signature are the ones being asked for. A caller that changes
 * either after signing is refused.
 */
export interface ConsoleReadVerifier {
  verify(input: {
    readonly receipt: string;
    readonly authorizationId: string;
  }): ConsoleReadVerification;
}

export function createConsoleReadVerifier({
  consoleAuthorityPublicKeyPem,
  now = () => new Date(),
}: {
  readonly consoleAuthorityPublicKeyPem: string;
  readonly now?: (() => Date) | undefined;
}): ConsoleReadVerifier {
  const publicKey: KeyObject = createPublicKey(consoleAuthorityPublicKeyPem);

  return {
    verify({ receipt, authorizationId }) {
      const parts = receipt.split(".");
      const [payload, signature] = parts;
      if (parts.length !== 2 || payload === undefined || signature === undefined) {
        return { status: "rejected" };
      }
      let verified: boolean;
      try {
        verified = verifyBytes(
          null,
          Buffer.from(payload),
          publicKey,
          Buffer.from(signature, "base64url"),
        );
      } catch {
        return { status: "rejected" };
      }
      if (!verified) {
        return { status: "rejected" };
      }

      let decoded: unknown;
      try {
        decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      } catch {
        return { status: "rejected" };
      }
      if (typeof decoded !== "object" || decoded === null) {
        return { status: "rejected" };
      }
      const claims = decoded as Record<string, unknown>;
      if (claims["audience"] !== CONSOLE_READ_AUDIENCE) {
        return { status: "rejected" };
      }
      const expiresAt = claims["expiresAt"];
      if (
        typeof expiresAt !== "string" ||
        Number.isNaN(Date.parse(expiresAt)) ||
        Date.parse(expiresAt) <= now().getTime()
      ) {
        return { status: "rejected" };
      }

      const signedAuthorizationId = claims["authorizationId"];
      const signedView = claims["view"];
      const signedReadMode = claims["readMode"];
      if (
        typeof signedAuthorizationId !== "string" ||
        signedAuthorizationId.length === 0 ||
        (signedView !== "overview" &&
          signedView !== "analytics" &&
          signedView !== "generation-detail") ||
        (signedReadMode !== "redacted" && signedReadMode !== "audit")
      ) {
        return { status: "rejected" };
      }
      if (signedAuthorizationId !== authorizationId) {
        return { status: "rejected" };
      }
      return {
        status: "verified",
        authorizationId: signedAuthorizationId,
        view: signedView,
        readMode: signedReadMode,
      };
    },
  };
}
