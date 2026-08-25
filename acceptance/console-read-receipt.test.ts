import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";

import { createConsoleReadAuthority } from "../apps/context-service/src/console/console-read-authority.js";
import { createConsoleReadVerifier } from "../apps/generation-service/src/console-read-verifier.js";

const keys = generateKeyPairSync("ed25519");
const consoleAuthorityPrivateKeyPem = keys.privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString();
const consoleAuthorityPublicKeyPem = keys.publicKey
  .export({ type: "spki", format: "pem" })
  .toString();

const authority = createConsoleReadAuthority({ consoleAuthorityPrivateKeyPem });
const authorizationId = "2ffad1ca-22f2-41ad-a9b3-07991a66cf76";
const expiresAt = "2026-08-19T12:05:00.000Z";
const inWindow = () => new Date("2026-08-19T12:00:00.000Z");

function signRead(
  input: Partial<{
    authorizationId: string;
    view: "overview" | "analytics" | "generation-detail";
    readMode: "redacted" | "audit";
    expiresAt: string;
  }> = {},
): string {
  return authority.signRead({
    authorizationId,
    view: "overview",
    readMode: "redacted",
    expiresAt,
    ...input,
  });
}

// The signer lives in Context and the verifier in Generation, so the seam is
// proven here rather than inside either deployable. Scope and raw authority are
// held by PostgreSQL; the receipt exposes only their opaque record id.
describe("Console read receipts", () => {
  it("accepts a current receipt for exactly the database authority it names", () => {
    const verifier = createConsoleReadVerifier({
      consoleAuthorityPublicKeyPem,
      now: inWindow,
    });

    expect(
      verifier.verify({ receipt: signRead(), authorizationId }),
    ).toEqual({
      status: "verified",
      authorizationId,
      view: "overview",
      readMode: "redacted",
    });
  });

  it("refuses a receipt replayed against another database authority", () => {
    const verifier = createConsoleReadVerifier({
      consoleAuthorityPublicKeyPem,
      now: inWindow,
    });

    expect(
      verifier.verify({
        receipt: signRead(),
        authorizationId: "8b082d5a-b429-4ae2-99bd-d7c438264662",
      }),
    ).toEqual({ status: "rejected" });
  });

  it("refuses an expired receipt", () => {
    const verifier = createConsoleReadVerifier({
      consoleAuthorityPublicKeyPem,
      now: () => new Date("2026-08-19T12:06:00.000Z"),
    });

    expect(
      verifier.verify({ receipt: signRead(), authorizationId }),
    ).toEqual({ status: "rejected" });
  });

  it("refuses a receipt signed by anything but Context", () => {
    const impostor = generateKeyPairSync("ed25519");
    const forged = createConsoleReadAuthority({
      consoleAuthorityPrivateKeyPem: impostor.privateKey
        .export({ type: "pkcs8", format: "pem" })
        .toString(),
    });
    const verifier = createConsoleReadVerifier({
      consoleAuthorityPublicKeyPem,
      now: inWindow,
    });

    expect(
      verifier.verify({
        receipt: forged.signRead({
          authorizationId,
          view: "overview",
          readMode: "redacted",
          expiresAt,
        }),
        authorizationId,
      }),
    ).toEqual({ status: "rejected" });
  });

  it("refuses a tampered payload and a malformed receipt", () => {
    const verifier = createConsoleReadVerifier({
      consoleAuthorityPublicKeyPem,
      now: inWindow,
    });
    const [, signature] = signRead().split(".");
    const tampered = `${Buffer.from(
      JSON.stringify({
        audience: "console-read",
        authorizationId,
        view: "generation-detail",
        readMode: "audit",
        expiresAt,
      }),
    ).toString("base64url")}.${signature}`;

    expect(
      verifier.verify({ receipt: tampered, authorizationId }),
    ).toEqual({ status: "rejected" });
    expect(
      verifier.verify({ receipt: "not-a-receipt", authorizationId }),
    ).toEqual({ status: "rejected" });
  });

  it("carries audit mode only when Context signed the DB-minted audit record", () => {
    const verifier = createConsoleReadVerifier({
      consoleAuthorityPublicKeyPem,
      now: inWindow,
    });

    expect(
      verifier.verify({
        receipt: signRead({ view: "generation-detail", readMode: "audit" }),
        authorizationId,
      }),
    ).toEqual({
      status: "verified",
      authorizationId,
      view: "generation-detail",
      readMode: "audit",
    });
  });
});
