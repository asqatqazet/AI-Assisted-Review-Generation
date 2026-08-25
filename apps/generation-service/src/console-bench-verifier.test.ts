import {
  createHash,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from "node:crypto";

import type { GenerationWorkloadDto } from "@review/contracts/generation";
import { describe, expect, it } from "vitest";

import {
  CONSOLE_BENCH_AUDIENCE,
  createConsoleBenchVerifier,
} from "./console-bench-verifier.js";

const encode = (value: string | Buffer): string =>
  Buffer.from(value).toString("base64url");

const hash = (workload: GenerationWorkloadDto): string =>
  `sha256:${createHash("sha256").update(JSON.stringify(workload)).digest("hex")}`;

function receipt(
  privateKey: KeyObject,
  workload: GenerationWorkloadDto,
  overrides: Readonly<Record<string, unknown>> = {},
): string {
  const payload = encode(
    JSON.stringify({
      audience: CONSOLE_BENCH_AUDIENCE,
      isBench: true,
      workloadHash: hash(workload),
      expiresAt: "2026-08-24T10:01:00.000Z",
      ...overrides,
    }),
  );
  return `${payload}.${encode(sign(null, Buffer.from(payload), privateKey))}`;
}

const workload = {
  bindings: { tenantId: "tenant-a", generationId: "generation-a" },
  snapshot: { snapshotId: "snapshot-a" },
  command: { kind: "generate" },
  assertions: [{ id: "assertion-a", proposition: "Attentive team." }],
} as unknown as GenerationWorkloadDto;

describe("Console Bench receipt verifier", () => {
  it("accepts only an unexpired Bench receipt bound to the exact workload", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const verifier = createConsoleBenchVerifier({
      consoleAuthorityPublicKeyPem: publicKey
        .export({ type: "spki", format: "pem" })
        .toString(),
      now: () => new Date("2026-08-24T10:00:00.000Z"),
    });
    const signed = receipt(privateKey, workload);

    expect(verifier.verify({ receipt: signed, workload })).toEqual({
      status: "verified",
    });
    expect(
      verifier.verify({
        receipt: signed,
        workload: {
          ...workload,
          assertions: [
            { ...workload.assertions[0]!, proposition: "Changed text." },
          ],
        },
      }),
    ).toEqual({ status: "rejected" });
  });

  it.each([
    ["a paid-work audience", { audience: "generation-paid-work" }],
    ["a non-Bench bit", { isBench: false }],
    ["an expired receipt", { expiresAt: "2026-08-24T09:59:59.000Z" }],
  ])("rejects %s", (_label, overrides) => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const verifier = createConsoleBenchVerifier({
      consoleAuthorityPublicKeyPem: publicKey
        .export({ type: "spki", format: "pem" })
        .toString(),
      now: () => new Date("2026-08-24T10:00:00.000Z"),
    });
    expect(
      verifier.verify({
        receipt: receipt(privateKey, workload, overrides),
        workload,
      }),
    ).toEqual({ status: "rejected" });
  });
});
