import { createHmac, randomUUID } from "node:crypto";

interface AuthorityProofInput {
  readonly secretHex: string;
  readonly issuedAtMs?: number;
  readonly nonce?: string;
}

export interface ConsoleDatabaseAuthorityProof {
  readonly issuedAtMs: number;
  readonly nonce: string;
  readonly mac: string;
}

function authorityKey(secretHex: string): Buffer {
  if (!/^[0-9a-f]{64}$/u.test(secretHex)) {
    throw new Error("Console database authority secret must be 32-byte hex");
  }
  return Buffer.from(secretHex, "hex");
}

function sign(
  secretHex: string,
  payload: string,
  issuedAtMs: number,
  nonce: string,
): ConsoleDatabaseAuthorityProof {
  return {
    issuedAtMs,
    nonce,
    mac: createHmac("sha256", authorityKey(secretHex))
      .update(payload, "utf8")
      .digest("hex"),
  };
}

const lengthPrefixed = (value: string): string =>
  `${Buffer.byteLength(value, "utf8")}:${value}`;

export function createConsoleOperatorAuthorizationProof({
  secretHex,
  operatorId,
  issuedAtMs = Date.now(),
  nonce = randomUUID(),
}: AuthorityProofInput & {
  readonly operatorId: string;
}): ConsoleDatabaseAuthorityProof {
  return sign(
    secretHex,
    `operator|${operatorId}|${issuedAtMs}|${nonce}`,
    issuedAtMs,
    nonce,
  );
}

export function createConsoleIdentityAuthorizationProof({
  secretHex,
  identity,
  issuedAtMs = Date.now(),
  nonce = randomUUID(),
}: AuthorityProofInput & {
  readonly identity: {
    readonly issuer: string;
    readonly subject: string;
    readonly email: string;
  };
}): ConsoleDatabaseAuthorityProof {
  const payload = [
    "identity",
    lengthPrefixed(identity.issuer),
    lengthPrefixed(identity.subject),
    lengthPrefixed(identity.email),
    `${issuedAtMs}`,
    nonce,
  ].join("|");
  return sign(secretHex, payload, issuedAtMs, nonce);
}
