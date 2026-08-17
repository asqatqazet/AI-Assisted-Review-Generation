import {
  generateKeyPairSync,
  sign as signBytes,
  verify as verifyBytes,
} from "node:crypto";
import type { GenerationWorkloadDto } from "@review/contracts/generation";
import { describe, expect, it } from "vitest";

import { createContextEd25519GenerationAuthority } from "./ed25519-generation-authority.js";

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

describe("US-03.2 Context Ed25519 generation authority", () => {
  it("signs Context evidence and accepts only Generation-signed receipts", async () => {
    const contextKeys = generateKeyPairSync("ed25519", {
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    const generationKeys = generateKeyPairSync("ed25519", {
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    const authority = createContextEd25519GenerationAuthority({
      contextPrivateKeyPem: contextKeys.privateKey,
      generationPublicKeyPem: generationKeys.publicKey,
      now: () => new Date("2026-08-17T12:00:00.000Z"),
    });

    const permit = await authority.signPermit({
      permitJti: "permit-a",
      expiresAt: "2026-08-17T12:01:00.000Z",
      workload,
    });
    const [permitPayload, permitSignature] = permit.split(".");
    expect(
      verifyBytes(
        null,
        Buffer.from(permitPayload!),
        contextKeys.publicKey,
        Buffer.from(permitSignature!, "base64url"),
      ),
    ).toBe(true);
    expect(JSON.parse(Buffer.from(permitPayload!, "base64url").toString())).toMatchObject({
      kind: "generation-permit",
      issuer: "context-service",
      audience: "generation-service",
      permitJti: "permit-a",
      bindings,
    });

    const leaseReceipt = signedBy(
      {
        kind: "generation-lease",
        issuer: "generation-service",
        audience: "context-service",
        permitJti: "permit-a",
        leaseId: "lease-a",
        leaseExpiresAt: "2026-08-17T12:00:45.000Z",
        bindings,
      },
      generationKeys.privateKey,
    );
    await expect(authority.verifyLease(leaseReceipt, workload)).resolves.toEqual({
      permitJti: "permit-a",
      leaseId: "lease-a",
      leaseExpiresAt: "2026-08-17T12:00:45.000Z",
    });

    const activation = await authority.signActivation({
      permitJti: "permit-a",
      leaseId: "lease-a",
      expiresAt: "2026-08-17T12:00:30.000Z",
      workload,
    });
    const [activationPayload, activationSignature] = activation.split(".");
    expect(
      verifyBytes(
        null,
        Buffer.from(activationPayload!),
        contextKeys.publicKey,
        Buffer.from(activationSignature!, "base64url"),
      ),
    ).toBe(true);

    const terminalReceipt = signedBy(
      {
        kind: "generation-terminal",
        issuer: "generation-service",
        audience: "context-service",
        permitJti: "permit-a",
        leaseId: "lease-a",
        outcome: "completed",
        actualCostMicros: 0,
        bindings,
      },
      generationKeys.privateKey,
    );
    await expect(
      authority.verifyTerminal(terminalReceipt, workload),
    ).resolves.toEqual({
      permitJti: "permit-a",
      leaseId: "lease-a",
      outcome: "completed",
      actualCostMicros: 0,
    });

    const forged = signedBy(
      {
        kind: "generation-terminal",
        issuer: "generation-service",
        audience: "context-service",
        permitJti: "permit-a",
        leaseId: "lease-a",
        outcome: "completed",
        actualCostMicros: 0,
        bindings,
      },
      contextKeys.privateKey,
    );
    await expect(authority.verifyTerminal(forged, workload)).rejects.toThrow(
      "GENERATION_RECEIPT_INVALID",
    );
  });
});
