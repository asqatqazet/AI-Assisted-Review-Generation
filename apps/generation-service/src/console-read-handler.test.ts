import { generateKeyPairSync, sign } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createConsoleReadHandler } from "./console-read-handler.js";
import { createConsoleReadVerifier } from "./console-read-verifier.js";

const keys = generateKeyPairSync("ed25519");
const consoleAuthorityPublicKeyPem = keys.publicKey
  .export({ type: "spki", format: "pem" })
  .toString();
const now = () => new Date("2026-08-24T00:00:00.000Z");

function receipt(
  authorizationId: string,
  readMode: "redacted" | "audit" = "redacted",
): string {
  const payload = Buffer.from(
    JSON.stringify({
      audience: "console-read",
      authorizationId,
      view: "overview",
      readMode,
      expiresAt: "2026-08-24T00:00:30.000Z",
    }),
  ).toString("base64url");
  return `${payload}.${Buffer.from(sign(null, Buffer.from(payload), keys.privateKey)).toString("base64url")}`;
}

const authorizationId = "2ffad1ca-22f2-41ad-a9b3-07991a66cf76";
const query = {
  view: "overview",
  from: "2026-08-01T00:00:00.000Z",
  to: "2026-08-24T00:00:00.000Z",
} as const;

describe("Console execution read handler", () => {
  it("reads only the opaque database authority Context signed", async () => {
    const reads: unknown[] = [];
    const handler = createConsoleReadHandler({
      verifier: createConsoleReadVerifier({ consoleAuthorityPublicKeyPem, now }),
      reader: {
        read: async (input) => {
          reads.push(input);
          return {
            status: "overview",
            data: {
              window: { from: query.from, to: query.to },
              metrics: {
                generations: 0,
                accepted: 0,
                acceptanceRate: 0,
                totalCost: { amountMicros: 0, currency: "EUR" },
                costPerAccepted: null,
              },
              byAction: [],
              byLocation: [],
              byTenant: [],
              experiment: null,
              providerHealth: [],
              alerts: [],
            },
          };
        },
      },
    });

    await expect(
      handler({
        operation: "console-read",
        input: {
          receipt: receipt(authorizationId),
          authorizationId,
        },
      }),
    ).resolves.toMatchObject({
      operation: "console-read",
      result: { status: "overview" },
    });
    expect(reads).toEqual([
      { authorizationId, view: "overview", readMode: "redacted" },
    ]);
  });

  it("returns the same not-found answer for a tampered authority id without reading", async () => {
    const reads: unknown[] = [];
    const handler = createConsoleReadHandler({
      verifier: createConsoleReadVerifier({ consoleAuthorityPublicKeyPem, now }),
      reader: {
        read: async (input) => {
          reads.push(input);
          return { status: "not-found" };
        },
      },
    });

    await expect(
      handler({
        operation: "console-read",
        input: {
          receipt: receipt(authorizationId),
          authorizationId: "8b082d5a-b429-4ae2-99bd-d7c438264662",
        },
      }),
    ).resolves.toEqual({
      operation: "console-read",
      result: { status: "not-found" },
    });
    expect(reads).toEqual([]);
  });
});
