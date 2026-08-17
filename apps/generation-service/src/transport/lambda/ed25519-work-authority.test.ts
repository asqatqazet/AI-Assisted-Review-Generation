import {
  generateKeyPairSync,
  sign as signBytes,
  verify as verifyBytes,
} from "node:crypto";
import type { GenerationWorkloadDto } from "@review/contracts/generation";
import { describe, expect, it } from "vitest";

import { createGenerationEd25519WorkAuthority } from "./ed25519-work-authority.js";

const bindings = {
  tenantId: "tenant-a",
  locationId: "location-a",
  reviewSessionId: "session-a",
  generationBatchId: "batch-a",
  generationId: "generation-a",
  action: "generate" as const,
  reviewFormatVersionId: "format-a",
  assertionSetHash: "sha256:assertions",
  requestHash: "sha256:request",
  snapshotId: "snapshot-a",
  snapshotHash: "sha256:snapshot",
  providerModelId: "provider-model-fake",
  priceRateId: "price-rate-fake",
  idempotencyKey: "request-a",
};
const workload = { bindings } as GenerationWorkloadDto;
const encode = (value: string | Uint8Array): string =>
  Buffer.from(value).toString("base64url");
const signedBy = (payload: unknown, privateKey: string): string => {
  const encodedPayload = encode(JSON.stringify(payload));
  return `${encodedPayload}.${encode(
    signBytes(null, Buffer.from(encodedPayload), privateKey),
  )}`;
};

describe("US-03.2 Generation Ed25519 work authority", () => {
  it("verifies only Context work and signs Generation evidence", async () => {
    const contextKeys = generateKeyPairSync("ed25519", {
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    const generationKeys = generateKeyPairSync("ed25519", {
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    const authority = createGenerationEd25519WorkAuthority({
      contextPublicKeyPem: contextKeys.publicKey,
      generationPrivateKeyPem: generationKeys.privateKey,
      now: () => new Date("2026-08-17T12:00:00.000Z"),
    });
    const permit = signedBy(
      {
        kind: "generation-permit",
        issuer: "context-service",
        audience: "generation-service",
        permitJti: "permit-a",
        expiresAt: "2026-08-17T12:01:00.000Z",
        bindings,
      },
      contextKeys.privateKey,
    );
    await expect(authority.verifyPermit(permit, workload)).resolves.toEqual({
      permitJti: "permit-a",
      expiresAt: "2026-08-17T12:01:00.000Z",
    });

    const leaseReceipt = await authority.signLease({
      permitJti: "permit-a",
      leaseId: "lease-a",
      leaseExpiresAt: "2026-08-17T12:00:45.000Z",
      ...bindings,
    });
    const [leasePayload, leaseSignature] = leaseReceipt.split(".");
    expect(
      verifyBytes(
        null,
        Buffer.from(leasePayload!),
        generationKeys.publicKey,
        Buffer.from(leaseSignature!, "base64url"),
      ),
    ).toBe(true);

    const activation = signedBy(
      {
        kind: "generation-activation",
        issuer: "context-service",
        audience: "generation-service",
        permitJti: "permit-a",
        leaseId: "lease-a",
        expiresAt: "2026-08-17T12:00:30.000Z",
        bindings,
      },
      contextKeys.privateKey,
    );
    await expect(
      authority.verifyActivation(activation, "lease-a", workload),
    ).resolves.toEqual({
      permitJti: "permit-a",
      expiresAt: "2026-08-17T12:00:30.000Z",
    });

    const terminalReceipt = await authority.signTerminal({
      leaseId: "lease-a",
      outcome: "completed",
      actualCostMicros: 0,
      ...bindings,
    });
    expect(
      JSON.parse(
        Buffer.from(terminalReceipt.split(".")[0]!, "base64url").toString(),
      ),
    ).toMatchObject({
      kind: "generation-terminal",
      issuer: "generation-service",
      audience: "context-service",
      leaseId: "lease-a",
      outcome: "completed",
      actualCostMicros: 0,
      bindings,
    });
  });
});
