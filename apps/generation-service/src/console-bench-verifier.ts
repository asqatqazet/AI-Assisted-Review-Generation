import {
  createHash,
  createPublicKey,
  verify as verifyBytes,
  type KeyObject,
} from "node:crypto";

import type { GenerationWorkloadDto } from "@review/contracts/generation";

export const CONSOLE_BENCH_AUDIENCE = "console-bench";

export type ConsoleBenchVerification =
  | { readonly status: "rejected" }
  | { readonly status: "verified" };

export interface ConsoleBenchVerifier {
  verify(input: {
    readonly receipt: string;
    readonly workload: GenerationWorkloadDto;
  }): ConsoleBenchVerification;
}

const workloadHash = (workload: GenerationWorkloadDto): string =>
  `sha256:${createHash("sha256")
    .update(JSON.stringify(workload))
    .digest("hex")}`;

export function createConsoleBenchVerifier({
  consoleAuthorityPublicKeyPem,
  now = () => new Date(),
}: {
  readonly consoleAuthorityPublicKeyPem: string;
  readonly now?: (() => Date) | undefined;
}): ConsoleBenchVerifier {
  const publicKey: KeyObject = createPublicKey(consoleAuthorityPublicKeyPem);
  return {
    verify({ receipt, workload }) {
      const parts = receipt.split(".");
      const [payload, signature] = parts;
      if (parts.length !== 2 || payload === undefined || signature === undefined) {
        return { status: "rejected" };
      }
      try {
        if (
          !verifyBytes(
            null,
            Buffer.from(payload),
            publicKey,
            Buffer.from(signature, "base64url"),
          )
        ) {
          return { status: "rejected" };
        }
      } catch {
        return { status: "rejected" };
      }

      let decoded: unknown;
      try {
        decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      } catch {
        return { status: "rejected" };
      }
      if (typeof decoded !== "object" || decoded === null) {
        return { status: "rejected" };
      }
      const claims = decoded as Record<string, unknown>;
      const expiresAt = claims["expiresAt"];
      if (
        claims["audience"] !== CONSOLE_BENCH_AUDIENCE ||
        claims["isBench"] !== true ||
        claims["workloadHash"] !== workloadHash(workload) ||
        typeof expiresAt !== "string" ||
        Number.isNaN(Date.parse(expiresAt)) ||
        Date.parse(expiresAt) <= now().getTime()
      ) {
        return { status: "rejected" };
      }
      return { status: "verified" };
    },
  };
}
