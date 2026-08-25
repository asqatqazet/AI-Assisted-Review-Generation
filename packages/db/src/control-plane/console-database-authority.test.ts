import { describe, expect, it } from "vitest";

import {
  createConsoleIdentityAuthorizationProof,
  createConsoleOperatorAuthorizationProof,
} from "./console-database-authority.js";

const secretHex = "ab".repeat(32);
const issuedAtMs = 1_787_529_600_000;
const nonce = "00000000-0000-4000-8000-000000000002";

describe("Console database authority proofs", () => {
  it("binds an Operator id to an exact canonical HMAC payload", () => {
    expect(
      createConsoleOperatorAuthorizationProof({
        secretHex,
        operatorId: "00000000-0000-4000-8000-000000000001",
        issuedAtMs,
        nonce,
      }),
    ).toEqual({
      issuedAtMs,
      nonce,
      mac: "796410d6b0763eca9fc6b2a1145dd0870955213c33ea335f8f56a733d7038a78",
    });
  });

  it("length-prefixes every OIDC identity field before signing", () => {
    expect(
      createConsoleIdentityAuthorizationProof({
        secretHex,
        identity: {
          issuer: "https://issuer.test",
          subject: "subject-1",
          email: "user@example.test",
        },
        issuedAtMs,
        nonce,
      }),
    ).toEqual({
      issuedAtMs,
      nonce,
      mac: "c2446c17821e28a469b758016ac2e61d575db33bcdea9efab2eaf96ff4bc3140",
    });
  });

  it("refuses a missing, short or non-hex authority secret", () => {
    for (const invalid of ["", "ab".repeat(31), "z".repeat(64)]) {
      expect(() =>
        createConsoleOperatorAuthorizationProof({
          secretHex: invalid,
          operatorId: "00000000-0000-4000-8000-000000000001",
          issuedAtMs,
          nonce,
        }),
      ).toThrow("Console database authority secret must be 32-byte hex");
    }
  });
});
