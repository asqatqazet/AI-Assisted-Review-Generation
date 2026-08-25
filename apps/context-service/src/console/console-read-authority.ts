import { createPrivateKey, sign as signBytes, type KeyObject } from "node:crypto";

/**
 * Signs the scope Context authorized so the execution plane can trust it
 * without holding Access Grants. Deliberately separate from the paid-work
 * authority: a read receipt confers no permission to spend, and mixing the two
 * would let a bug in one widen the other.
 */
export interface ConsoleReadAuthority {
  signRead(input: {
    readonly authorizationId: string;
    readonly view: "overview" | "analytics" | "generation-detail";
    readonly readMode: "redacted" | "audit";
    readonly expiresAt: string;
  }): string;
}

const encode = (value: string | Buffer): string =>
  Buffer.from(value).toString("base64url");

export const CONSOLE_READ_AUDIENCE = "console-read";

export function createConsoleReadAuthority({
  consoleAuthorityPrivateKeyPem,
}: {
  readonly consoleAuthorityPrivateKeyPem: string;
}): ConsoleReadAuthority {
  const privateKey: KeyObject = createPrivateKey(consoleAuthorityPrivateKeyPem);
  return {
    signRead({ authorizationId, view, readMode, expiresAt }) {
      const payload = encode(
        JSON.stringify({
          audience: CONSOLE_READ_AUDIENCE,
          authorizationId,
          view,
          readMode,
          expiresAt,
        }),
      );
      return `${payload}.${encode(signBytes(null, Buffer.from(payload), privateKey))}`;
    },
  };
}
