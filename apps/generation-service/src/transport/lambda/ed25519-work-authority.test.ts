import {
  createHash,
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
const finalText = "The team was exceptionally attentive.";
const dispositionScope = {
  tenantId: bindings.tenantId,
  locationId: bindings.locationId,
  reviewSessionId: bindings.reviewSessionId,
  draftId: "draft-a",
  generationId: bindings.generationId,
  finalTextHash: `sha256:${createHash("sha256").update(finalText).digest("hex")}`,
  idempotencyKey: "disposition-a",
};
const draftRevisionScope = {
  tenantId: bindings.tenantId,
  locationId: bindings.locationId,
  reviewSessionId: bindings.reviewSessionId,
  draftId: "draft-a",
  generationId: bindings.generationId,
  expectedRevision: 1,
  textHash: `sha256:${createHash("sha256").update(finalText).digest("hex")}`,
  idempotencyKey: "draft-save-a",
};
const encode = (value: string | Uint8Array): string =>
  Buffer.from(value).toString("base64url");
const signedBy = (payload: unknown, privateKey: string): string => {
  const encodedPayload = encode(JSON.stringify(payload));
  return `${encodedPayload}.${encode(
    signBytes(null, Buffer.from(encodedPayload), privateKey),
  )}`;
};

describe("US-03.2 Generation Ed25519 work authority", () => {
  it("rejects paid work signed by the isolated Console authority", async () => {
    const contextKeys = generateKeyPairSync("ed25519", {
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    const consoleAuthorityKeys = generateKeyPairSync("ed25519", {
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
    const consoleForgedPermit = signedBy(
      {
        kind: "generation-permit",
        issuer: "context-service",
        audience: "generation-service",
        permitJti: "console-forged-permit",
        expiresAt: "2026-08-17T12:01:00.000Z",
        bindings,
      },
      consoleAuthorityKeys.privateKey,
    );

    await expect(
      authority.verifyPermit(consoleForgedPermit, workload),
    ).rejects.toThrow("GENERATION_WORK_AUTHORITY_INVALID");
  });

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

    const dispositionPermit = signedBy(
      {
        kind: "reviewer-disposition-permit",
        issuer: "context-service",
        audience: "generation-service",
        permitJti: "disposition-permit-a",
        expiresAt: "2026-08-17T12:01:00.000Z",
        scope: dispositionScope,
      },
      contextKeys.privateKey,
    );
    await expect(
      authority.verifyDispositionPermit(
        dispositionPermit,
        dispositionScope,
        finalText,
      ),
    ).resolves.toEqual({ permitJti: "disposition-permit-a" });
    await expect(
      authority.verifyDispositionPermit(
        dispositionPermit,
        dispositionScope,
        `${finalText} Invented text.`,
      ),
    ).rejects.toThrow("GENERATION_WORK_AUTHORITY_INVALID");

    const draftRevisionPermit = signedBy(
      {
        kind: "reviewer-draft-revision-permit",
        issuer: "context-service",
        audience: "generation-service",
        permitJti: "draft-revision-permit-a",
        expiresAt: "2026-08-17T12:01:00.000Z",
        scope: draftRevisionScope,
      },
      contextKeys.privateKey,
    );
    await expect(
      authority.verifyDraftRevisionPermit(
        draftRevisionPermit,
        draftRevisionScope,
        finalText,
      ),
    ).resolves.toEqual({ permitJti: "draft-revision-permit-a" });
    await expect(
      authority.verifyDraftRevisionPermit(
        dispositionPermit,
        draftRevisionScope,
        finalText,
      ),
    ).rejects.toThrow("GENERATION_WORK_AUTHORITY_INVALID");
    await expect(
      authority.verifyDraftRevisionPermit(
        draftRevisionPermit,
        draftRevisionScope,
        `${finalText} Invented text.`,
      ),
    ).rejects.toThrow("GENERATION_WORK_AUTHORITY_INVALID");

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
      permitJti: "permit-a",
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
