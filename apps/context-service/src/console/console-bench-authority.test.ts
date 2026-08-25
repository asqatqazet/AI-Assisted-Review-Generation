import { generateKeyPairSync, verify } from "node:crypto";

import type { GenerationWorkloadDto } from "@review/contracts/generation";
import { describe, expect, it } from "vitest";

import {
  CONSOLE_BENCH_AUDIENCE,
  createConsoleBenchAuthority,
} from "./console-bench-authority.js";

describe("Console Bench authority", () => {
  it("signs a separate Bench-only audience over the whole immutable workload", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const workload = {
      bindings: { tenantId: "tenant-a", generationId: "generation-a" },
      snapshot: { snapshotId: "snapshot-a" },
      command: { kind: "generate" },
      assertions: [{ id: "assertion-a", proposition: "Attentive team." }],
    } as unknown as GenerationWorkloadDto;
    const authority = createConsoleBenchAuthority({
      consoleAuthorityPrivateKeyPem: privateKey
        .export({ type: "pkcs8", format: "pem" })
        .toString(),
    });

    const receipt = authority.signBench({
      workload,
      isBench: true,
      expiresAt: "2026-08-24T10:01:00.000Z",
    });
    const [payload, signature] = receipt.split(".");
    expect(
      verify(
        null,
        Buffer.from(payload!),
        publicKey,
        Buffer.from(signature!, "base64url"),
      ),
    ).toBe(true);
    expect(
      JSON.parse(Buffer.from(payload!, "base64url").toString("utf8")),
    ).toMatchObject({
      audience: CONSOLE_BENCH_AUDIENCE,
      isBench: true,
      expiresAt: "2026-08-24T10:01:00.000Z",
      workloadHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
  });
});
