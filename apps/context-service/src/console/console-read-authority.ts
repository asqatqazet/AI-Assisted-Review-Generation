import { createPrivateKey, sign as signBytes, type KeyObject } from "node:crypto";

import type {
  ConsoleReadQueryDto,
  ConsoleReadScopeDto,
} from "@review/contracts/console";

/**
 * Signs the scope Context authorized so the execution plane can trust it
 * without holding Access Grants. Deliberately separate from the paid-work
 * authority: a read receipt confers no permission to spend, and mixing the two
 * would let a bug in one widen the other.
 */
export interface ConsoleReadAuthority {
  signRead(input: {
    readonly scope: ConsoleReadScopeDto;
    readonly query: ConsoleReadQueryDto;
    readonly expiresAt: string;
  }): string;
}

const encode = (value: string | Buffer): string =>
  Buffer.from(value).toString("base64url");

export const CONSOLE_READ_AUDIENCE = "console-read";

export function createConsoleReadAuthority({
  contextPrivateKeyPem,
}: {
  readonly contextPrivateKeyPem: string;
}): ConsoleReadAuthority {
  const privateKey: KeyObject = createPrivateKey(contextPrivateKeyPem);
  return {
    signRead({ scope, query, expiresAt }) {
      const payload = encode(
        JSON.stringify({
          audience: CONSOLE_READ_AUDIENCE,
          scope,
          // The query is bound in, so a receipt for one venue's overview
          // cannot be replayed to read another view or another range.
          query,
          expiresAt,
        }),
      );
      return `${payload}.${encode(signBytes(null, Buffer.from(payload), privateKey))}`;
    },
  };
}
