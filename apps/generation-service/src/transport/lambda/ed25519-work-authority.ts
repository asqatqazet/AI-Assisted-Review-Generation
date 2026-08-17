import {
  createPrivateKey,
  createPublicKey,
  sign as signBytes,
  verify as verifyBytes,
  type KeyObject,
} from "node:crypto";
import {
  GenerationWorkloadBindingsDtoSchema,
  type GenerationWorkloadDto,
} from "@review/contracts/generation";

import type {
  GenerationReceiptSigner,
  VerifiedGenerationActivation,
  VerifiedGenerationPermit,
} from "./paid-work-handler.js";

type JsonRecord = Readonly<Record<string, unknown>>;
type WorkBindings = GenerationWorkloadDto["bindings"];

export interface GenerationEd25519WorkAuthority
  extends GenerationReceiptSigner {
  verifyPermit(
    permit: string,
    workload: GenerationWorkloadDto,
  ): Promise<VerifiedGenerationPermit>;
  verifyActivation(
    activation: string,
    leaseId: string,
    workload: GenerationWorkloadDto,
  ): Promise<VerifiedGenerationActivation>;
}

const encode = (value: string | Uint8Array): string =>
  Buffer.from(value).toString("base64url");

const record = (value: unknown): JsonRecord => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("GENERATION_WORK_AUTHORITY_INVALID");
  }
  return value as JsonRecord;
};

const stringField = (value: JsonRecord, key: string): string => {
  const field = value[key];
  if (typeof field !== "string" || field.length === 0) {
    throw new Error("GENERATION_WORK_AUTHORITY_INVALID");
  }
  return field;
};

const exactKeys = (value: JsonRecord, expected: readonly string[]): void => {
  if (
    JSON.stringify(Object.keys(value).sort()) !==
    JSON.stringify([...expected].sort())
  ) {
    throw new Error("GENERATION_WORK_AUTHORITY_INVALID");
  }
};

const bindingsMatch = (
  payload: JsonRecord,
  workload: GenerationWorkloadDto,
): void => {
  const parsed = GenerationWorkloadBindingsDtoSchema.parse(payload["bindings"]);
  if (JSON.stringify(parsed) !== JSON.stringify(workload.bindings)) {
    throw new Error("GENERATION_WORK_AUTHORITY_INVALID");
  }
};

const fromFlatClaims = (claims: JsonRecord): WorkBindings =>
  GenerationWorkloadBindingsDtoSchema.parse({
    tenantId: claims["tenantId"],
    locationId: claims["locationId"],
    reviewSessionId: claims["reviewSessionId"],
    generationBatchId: claims["generationBatchId"],
    generationId: claims["generationId"],
    action: claims["action"],
    reviewFormatVersionId: claims["reviewFormatVersionId"],
    assertionSetHash: claims["assertionSetHash"],
    requestHash: claims["requestHash"],
    snapshotId: claims["snapshotId"],
    snapshotHash: claims["snapshotHash"],
    providerModelId: claims["providerModelId"],
    priceRateId: claims["priceRateId"],
    idempotencyKey: claims["idempotencyKey"],
  });

const signToken = (payload: JsonRecord, privateKey: KeyObject): string => {
  const encodedPayload = encode(JSON.stringify(payload));
  return `${encodedPayload}.${encode(
    signBytes(null, Buffer.from(encodedPayload), privateKey),
  )}`;
};

const verifyToken = (token: string, publicKey: KeyObject): JsonRecord => {
  const parts = token.split(".");
  if (parts.length !== 2 || parts[0] === undefined || parts[1] === undefined) {
    throw new Error("GENERATION_WORK_AUTHORITY_INVALID");
  }
  try {
    if (
      !verifyBytes(
        null,
        Buffer.from(parts[0]),
        publicKey,
        Buffer.from(parts[1], "base64url"),
      )
    ) {
      throw new Error("GENERATION_WORK_AUTHORITY_INVALID");
    }
    return record(JSON.parse(Buffer.from(parts[0], "base64url").toString()));
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "GENERATION_WORK_AUTHORITY_INVALID"
    ) {
      throw error;
    }
    throw new Error("GENERATION_WORK_AUTHORITY_INVALID", { cause: error });
  }
};

export function createGenerationEd25519WorkAuthority({
  contextPublicKeyPem,
  generationPrivateKeyPem,
  now = () => new Date(),
}: {
  readonly contextPublicKeyPem: string;
  readonly generationPrivateKeyPem: string;
  readonly now?: () => Date;
}): GenerationEd25519WorkAuthority {
  const contextPublicKey = createPublicKey(contextPublicKeyPem);
  const generationPrivateKey = createPrivateKey(generationPrivateKeyPem);

  const verifyContextEvidence = (
    token: string,
    workload: GenerationWorkloadDto,
    expectedKind: "generation-permit" | "generation-activation",
  ): JsonRecord => {
    const payload = verifyToken(token, contextPublicKey);
    if (
      payload["kind"] !== expectedKind ||
      payload["issuer"] !== "context-service" ||
      payload["audience"] !== "generation-service"
    ) {
      throw new Error("GENERATION_WORK_AUTHORITY_INVALID");
    }
    bindingsMatch(payload, workload);
    return payload;
  };

  return {
    async verifyPermit(permit, workload) {
      const payload = verifyContextEvidence(
        permit,
        workload,
        "generation-permit",
      );
      exactKeys(payload, [
        "kind",
        "issuer",
        "audience",
        "permitJti",
        "expiresAt",
        "bindings",
      ]);
      const expiresAt = stringField(payload, "expiresAt");
      if (new Date(expiresAt).getTime() <= now().getTime()) {
        throw new Error("GENERATION_PERMIT_EXPIRED");
      }
      return { permitJti: stringField(payload, "permitJti"), expiresAt };
    },

    async verifyActivation(activation, leaseId, workload) {
      const payload = verifyContextEvidence(
        activation,
        workload,
        "generation-activation",
      );
      exactKeys(payload, [
        "kind",
        "issuer",
        "audience",
        "permitJti",
        "leaseId",
        "expiresAt",
        "bindings",
      ]);
      const expiresAt = stringField(payload, "expiresAt");
      if (
        stringField(payload, "leaseId") !== leaseId ||
        new Date(expiresAt).getTime() <= now().getTime()
      ) {
        throw new Error("GENERATION_ACTIVATION_INVALID");
      }
      return { permitJti: stringField(payload, "permitJti"), expiresAt };
    },

    async signLease(claims) {
      return signToken(
        {
          kind: "generation-lease",
          issuer: "generation-service",
          audience: "context-service",
          permitJti: claims.permitJti,
          leaseId: claims.leaseId,
          leaseExpiresAt: claims.leaseExpiresAt,
          bindings: fromFlatClaims(claims),
        },
        generationPrivateKey,
      );
    },

    async signTerminal(claims) {
      return signToken(
        {
          kind: "generation-terminal",
          issuer: "generation-service",
          audience: "context-service",
          permitJti: claims.permitJti,
          leaseId: claims.leaseId,
          outcome: claims.outcome,
          actualCostMicros: claims.actualCostMicros,
          bindings: fromFlatClaims(claims),
        },
        generationPrivateKey,
      );
    },

    async signStatus(claims) {
      return signToken(
        {
          kind: "generation-status",
          issuer: "generation-service",
          audience: "context-service",
          ...claims,
        },
        generationPrivateKey,
      );
    },
  };
}
