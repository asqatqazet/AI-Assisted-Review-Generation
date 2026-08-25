import {
  createHash,
  createPrivateKey,
  sign as signBytes,
  type KeyObject,
} from "node:crypto";

import type { GenerationWorkloadDto } from "@review/contracts/generation";

import type { ConsoleBenchAuthority } from "./console-bench-authorizer.js";

export const CONSOLE_BENCH_AUDIENCE = "console-bench";

const encode = (value: string | Buffer): string =>
  Buffer.from(value).toString("base64url");

const workloadHash = (workload: GenerationWorkloadDto): string =>
  `sha256:${createHash("sha256")
    .update(JSON.stringify(workload))
    .digest("hex")}`;

/** A Bench receipt cannot authorize paid work or a Console history read. */
export function createConsoleBenchAuthority({
  consoleAuthorityPrivateKeyPem,
}: {
  readonly consoleAuthorityPrivateKeyPem: string;
}): ConsoleBenchAuthority {
  const privateKey: KeyObject = createPrivateKey(consoleAuthorityPrivateKeyPem);
  return {
    signBench({ workload, isBench, expiresAt }) {
      const payload = encode(
        JSON.stringify({
          audience: CONSOLE_BENCH_AUDIENCE,
          isBench,
          workloadHash: workloadHash(workload),
          expiresAt,
        }),
      );
      return `${payload}.${encode(signBytes(null, Buffer.from(payload), privateKey))}`;
    },
  };
}
