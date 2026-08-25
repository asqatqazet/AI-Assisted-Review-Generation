import {
  createPrivateKey,
  createPublicKey,
  sign as signBytes,
  verify as verifyBytes,
  type KeyObject,
} from "node:crypto";
import {
  GenerationExecutionScopeDtoSchema,
  GenerationWorkloadBindingsDtoSchema,
  ReviewerDraftRevisionScopeDtoSchema,
  ReviewerDispositionScopeDtoSchema,
  type GenerationWorkloadDto,
} from "@review/contracts/generation";

import type {
  ContextGenerationAuthority,
  ContextGenerationStatusAuthority,
} from "./reviewer-generation-service.js";
import type { ContextDispositionAuthority } from "./reviewer-disposition-service.js";
import type { ContextDraftRevisionAuthority } from "./reviewer-draft-revision-service.js";

type JsonRecord = Readonly<Record<string, unknown>>;

const encode = (value: string | Uint8Array): string =>
  Buffer.from(value).toString("base64url");

const record = (value: unknown): JsonRecord => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("GENERATION_RECEIPT_INVALID");
  }
  return value as JsonRecord;
};

const stringField = (value: JsonRecord, key: string): string => {
  const field = value[key];
  if (typeof field !== "string" || field.length === 0) {
    throw new Error("GENERATION_RECEIPT_INVALID");
  }
  return field;
};

const exactKeys = (value: JsonRecord, expected: readonly string[]): void => {
  if (
    JSON.stringify(Object.keys(value).sort()) !==
    JSON.stringify([...expected].sort())
  ) {
    throw new Error("GENERATION_RECEIPT_INVALID");
  }
};

const bindingsMatch = (
  payload: JsonRecord,
  workload: GenerationWorkloadDto,
): void => {
  const bindings = GenerationWorkloadBindingsDtoSchema.parse(payload["bindings"]);
  if (JSON.stringify(bindings) !== JSON.stringify(workload.bindings)) {
    throw new Error("GENERATION_RECEIPT_INVALID");
  }
};

function signToken(payload: JsonRecord, privateKey: KeyObject): string {
  const encodedPayload = encode(JSON.stringify(payload));
  const signature = signBytes(null, Buffer.from(encodedPayload), privateKey);
  return `${encodedPayload}.${encode(signature)}`;
}

function verifyToken(token: string, publicKey: KeyObject): JsonRecord {
  const parts = token.split(".");
  if (parts.length !== 2 || parts[0] === undefined || parts[1] === undefined) {
    throw new Error("GENERATION_RECEIPT_INVALID");
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
      throw new Error("GENERATION_RECEIPT_INVALID");
    }
    return record(JSON.parse(Buffer.from(parts[0], "base64url").toString()));
  } catch (error) {
    if (error instanceof Error && error.message === "GENERATION_RECEIPT_INVALID") {
      throw error;
    }
    throw new Error("GENERATION_RECEIPT_INVALID", { cause: error });
  }
}

export function createContextEd25519GenerationAuthority({
  contextPrivateKeyPem,
  generationPublicKeyPem,
  now = () => new Date(),
}: {
  readonly contextPrivateKeyPem: string;
  readonly generationPublicKeyPem: string;
  readonly now?: () => Date;
}): ContextGenerationAuthority &
  ContextGenerationStatusAuthority &
  ContextDraftRevisionAuthority &
  ContextDispositionAuthority {
  const contextPrivateKey = createPrivateKey(contextPrivateKeyPem);
  const generationPublicKey = createPublicKey(generationPublicKeyPem);

  return {
    async signPermit({ permitJti, expiresAt, workload }) {
      if (new Date(expiresAt).getTime() <= now().getTime()) {
        throw new Error("GENERATION_PERMIT_EXPIRED");
      }
      return signToken(
        {
          kind: "generation-permit",
          issuer: "context-service",
          audience: "generation-service",
          permitJti,
          expiresAt,
          bindings: workload.bindings,
        },
        contextPrivateKey,
      );
    },

    async signDispositionPermit({ permitJti, expiresAt, scope }) {
      if (new Date(expiresAt).getTime() <= now().getTime()) {
        throw new Error("REVIEWER_DISPOSITION_PERMIT_EXPIRED");
      }
      return signToken(
        {
          kind: "reviewer-disposition-permit",
          issuer: "context-service",
          audience: "generation-service",
          permitJti,
          expiresAt,
          scope: ReviewerDispositionScopeDtoSchema.parse(scope),
        },
        contextPrivateKey,
      );
    },

    async signDraftRevisionPermit({ permitJti, expiresAt, scope }) {
      if (new Date(expiresAt).getTime() <= now().getTime()) {
        throw new Error("REVIEWER_DRAFT_REVISION_PERMIT_EXPIRED");
      }
      return signToken(
        {
          kind: "reviewer-draft-revision-permit",
          issuer: "context-service",
          audience: "generation-service",
          permitJti,
          expiresAt,
          scope: ReviewerDraftRevisionScopeDtoSchema.parse(scope),
        },
        contextPrivateKey,
      );
    },

    async verifyLease(receipt, workload) {
      const payload = verifyToken(receipt, generationPublicKey);
      exactKeys(payload, [
        "kind",
        "issuer",
        "audience",
        "permitJti",
        "leaseId",
        "leaseExpiresAt",
        "bindings",
      ]);
      if (
        payload["kind"] !== "generation-lease" ||
        payload["issuer"] !== "generation-service" ||
        payload["audience"] !== "context-service"
      ) {
        throw new Error("GENERATION_RECEIPT_INVALID");
      }
      bindingsMatch(payload, workload);
      const leaseExpiresAt = stringField(payload, "leaseExpiresAt");
      if (new Date(leaseExpiresAt).getTime() <= now().getTime()) {
        throw new Error("GENERATION_RECEIPT_INVALID");
      }
      return {
        permitJti: stringField(payload, "permitJti"),
        leaseId: stringField(payload, "leaseId"),
        leaseExpiresAt,
      };
    },

    async signActivation({ permitJti, leaseId, expiresAt, workload }) {
      if (new Date(expiresAt).getTime() <= now().getTime()) {
        throw new Error("GENERATION_ACTIVATION_EXPIRED");
      }
      return signToken(
        {
          kind: "generation-activation",
          issuer: "context-service",
          audience: "generation-service",
          permitJti,
          leaseId,
          expiresAt,
          bindings: workload.bindings,
        },
        contextPrivateKey,
      );
    },

    async verifyTerminal(receipt, workload) {
      const payload = verifyToken(receipt, generationPublicKey);
      exactKeys(payload, [
        "kind",
        "issuer",
        "audience",
        "permitJti",
        "leaseId",
        "outcome",
        "actualCostMicros",
        "bindings",
      ]);
      if (
        payload["kind"] !== "generation-terminal" ||
        payload["issuer"] !== "generation-service" ||
        payload["audience"] !== "context-service" ||
        (payload["outcome"] !== "completed" &&
          payload["outcome"] !== "rejected") ||
        typeof payload["actualCostMicros"] !== "number" ||
        !Number.isSafeInteger(payload["actualCostMicros"]) ||
        payload["actualCostMicros"] < 0
      ) {
        throw new Error("GENERATION_RECEIPT_INVALID");
      }
      bindingsMatch(payload, workload);
      return {
        permitJti: stringField(payload, "permitJti"),
        leaseId: stringField(payload, "leaseId"),
        outcome: payload["outcome"],
        actualCostMicros: payload["actualCostMicros"],
      };
    },

    async verifyStatus(receipt, expected) {
      const payload = verifyToken(receipt, generationPublicKey);
      const expectedKeys =
        expected.operation === "status"
          ? ["kind", "issuer", "audience", "operation", "state", "scope"]
          : [
              "kind",
              "issuer",
              "audience",
              "operation",
              "state",
              "leaseId",
              "scope",
            ];
      exactKeys(payload, expectedKeys);
      if (
        payload["kind"] !== "generation-status" ||
        payload["issuer"] !== "generation-service" ||
        payload["audience"] !== "context-service" ||
        payload["operation"] !== expected.operation ||
        payload["state"] !== expected.outcome
      ) {
        throw new Error("GENERATION_RECEIPT_INVALID");
      }
      const scope = GenerationExecutionScopeDtoSchema.parse(payload["scope"]);
      const bindings = expected.workload.bindings;
      if (
        JSON.stringify(scope) !==
        JSON.stringify({
          tenantId: bindings.tenantId,
          locationId: bindings.locationId,
          reviewSessionId: bindings.reviewSessionId,
          generationBatchId: bindings.generationBatchId,
          generationId: bindings.generationId,
          permitJti: expected.permitJti,
        })
      ) {
        throw new Error("GENERATION_RECEIPT_INVALID");
      }
      if (
        expected.operation === "cancel-expired-lease" &&
        payload["leaseId"] !== expected.leaseId
      ) {
        throw new Error("GENERATION_RECEIPT_INVALID");
      }
    },
  };
}
