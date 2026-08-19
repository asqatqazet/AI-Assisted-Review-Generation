import { generateKeyPairSync } from "node:crypto";
import type {
  ConsoleReadQueryDto,
  ConsoleReadScopeDto,
} from "@review/contracts/console-read";
import { describe, expect, it } from "vitest";

import { createConsoleReadAuthority } from "../apps/context-service/src/console/console-read-authority.js";
import { createConsoleReadVerifier } from "../apps/generation-service/src/console-read-verifier.js";

const keys = generateKeyPairSync("ed25519");
const contextPrivateKeyPem = keys.privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString();
const contextPublicKeyPem = keys.publicKey
  .export({ type: "spki", format: "pem" })
  .toString();

const authority = createConsoleReadAuthority({ contextPrivateKeyPem });
const scope: ConsoleReadScopeDto = { type: "tenant", tenantId: "tenant-a" };
const query: ConsoleReadQueryDto = {
  view: "overview",
  from: "2026-07-19T00:00:00.000Z",
  to: "2026-08-18T00:00:00.000Z",
};
const expiresAt = "2026-08-19T12:05:00.000Z";
const inWindow = () => new Date("2026-08-19T12:00:00.000Z");

// The signer lives in Context and the verifier in Generation, so the seam
// is proven here rather than inside either deployable.
describe("Console read receipts", () => {
  it("accepts a current receipt for exactly the scope and query it names", () => {
    const verifier = createConsoleReadVerifier({
      contextPublicKeyPem,
      now: inWindow,
    });

    expect(
      verifier.verify({
        receipt: authority.signRead({ scope, query, expiresAt }),
        scope,
        query,
      }),
    ).toEqual({ status: "verified", scope, query });
  });

  it("refuses a receipt replayed against another Tenant", () => {
    const verifier = createConsoleReadVerifier({
      contextPublicKeyPem,
      now: inWindow,
    });

    expect(
      verifier.verify({
        receipt: authority.signRead({ scope, query, expiresAt }),
        scope: { type: "tenant", tenantId: "tenant-b" },
        query,
      }),
    ).toEqual({ status: "rejected" });
  });

  it("refuses a receipt replayed against another view or date range", () => {
    const verifier = createConsoleReadVerifier({
      contextPublicKeyPem,
      now: inWindow,
    });
    const receipt = authority.signRead({ scope, query, expiresAt });

    expect(
      verifier.verify({
        receipt,
        scope,
        query: { view: "generation-detail", generationId: "generation-1" },
      }),
    ).toEqual({ status: "rejected" });
    expect(
      verifier.verify({
        receipt,
        scope,
        query: { ...query, to: "2026-12-31T00:00:00.000Z" },
      }),
    ).toEqual({ status: "rejected" });
  });

  it("refuses an expired receipt", () => {
    const verifier = createConsoleReadVerifier({
      contextPublicKeyPem,
      now: () => new Date("2026-08-19T12:06:00.000Z"),
    });

    expect(
      verifier.verify({
        receipt: authority.signRead({ scope, query, expiresAt }),
        scope,
        query,
      }),
    ).toEqual({ status: "rejected" });
  });

  it("refuses a receipt signed by anything but Context", () => {
    const impostor = generateKeyPairSync("ed25519");
    const forged = createConsoleReadAuthority({
      contextPrivateKeyPem: impostor.privateKey
        .export({ type: "pkcs8", format: "pem" })
        .toString(),
    });
    const verifier = createConsoleReadVerifier({
      contextPublicKeyPem,
      now: inWindow,
    });

    expect(
      verifier.verify({
        receipt: forged.signRead({ scope, query, expiresAt }),
        scope,
        query,
      }),
    ).toEqual({ status: "rejected" });
  });

  it("refuses a tampered payload and a malformed receipt", () => {
    const verifier = createConsoleReadVerifier({
      contextPublicKeyPem,
      now: inWindow,
    });
    const receipt = authority.signRead({ scope, query, expiresAt });
    const [, signature] = receipt.split(".");
    const tampered = `${Buffer.from(
      JSON.stringify({
        audience: "console-read",
        scope: { type: "platform" },
        query,
        expiresAt,
      }),
    ).toString("base64url")}.${signature}`;

    expect(
      verifier.verify({ receipt: tampered, scope: { type: "platform" }, query }),
    ).toEqual({ status: "rejected" });
    expect(verifier.verify({ receipt: "not-a-receipt", scope, query })).toEqual({
      status: "rejected",
    });
  });
});
