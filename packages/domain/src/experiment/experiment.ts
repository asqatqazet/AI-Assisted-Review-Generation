import type { CommandKind } from "../configuration/index.js";

export type PromptVersionStatus =
  | "draft"
  | "candidate"
  | "in-experiment"
  | "retired";

export interface PromptVersionInput {
  readonly key: string;
  readonly commandKind: CommandKind;
  readonly body: string;
  readonly variables: readonly string[];
}

export interface PromptVersionRecord extends PromptVersionInput {
  readonly hash: `sha256:${string}`;
  readonly status: PromptVersionStatus;
}

export interface ExperimentVariant {
  readonly variantKey: string;
  readonly promptVersionHash: string;
  readonly weightPct: number;
}

export interface ExperimentDefinition {
  readonly id: string;
  readonly tenantId: string;
  readonly action: CommandKind;
  readonly status: "draft" | "running" | "stopped";
  readonly variants: readonly ExperimentVariant[];
}

export interface EvaluationResult {
  readonly passRate: number;
  readonly evaluatedCases: number;
}

// Pure in-memory SHA-256 implementation (Domain purity)
function sha256Pure(message: string): string {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  function utf8Encode(str: string): number[] {
    const bytes: number[] = [];
    for (let i = 0; i < str.length; i++) {
      let code = str.charCodeAt(i);
      if (code < 0x80) {
        bytes.push(code);
      } else if (code < 0x800) {
        bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
      } else if (code < 0xd800 || code >= 0xe000) {
        bytes.push(
          0xe0 | (code >> 12),
          0x80 | ((code >> 6) & 0x3f),
          0x80 | (code & 0x3f),
        );
      } else {
        i++;
        code = 0x10000 + (((code & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
        bytes.push(
          0xf0 | (code >> 18),
          0x80 | ((code >> 12) & 0x3f),
          0x80 | ((code >> 6) & 0x3f),
          0x80 | (code & 0x3f),
        );
      }
    }
    return bytes;
  }

  const bytes = utf8Encode(message);
  const bitLength = bytes.length * 8;

  bytes.push(0x80);
  while ((bytes.length + 8) % 64 !== 0) {
    bytes.push(0);
  }

  for (let i = 7; i >= 0; i--) {
    bytes.push((bitLength / Math.pow(2, i * 8)) & 0xff);
  }

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Array<number>(64);

  for (let i = 0; i < bytes.length; i += 64) {
    for (let t = 0; t < 16; t++) {
      const idx = i + t * 4;
      w[t] =
        ((bytes[idx]! << 24) |
          (bytes[idx + 1]! << 16) |
          (bytes[idx + 2]! << 8) |
          bytes[idx + 3]!) >>>
        0;
    }

    for (let t = 16; t < 64; t++) {
      const s0 =
        (((w[t - 15]! >>> 7) | (w[t - 15]! << 25)) ^
          ((w[t - 15]! >>> 18) | (w[t - 15]! << 14)) ^
          (w[t - 15]! >>> 3)) >>>
        0;
      const s1 =
        (((w[t - 2]! >>> 17) | (w[t - 2]! << 15)) ^
          ((w[t - 2]! >>> 19) | (w[t - 2]! << 13)) ^
          (w[t - 2]! >>> 10)) >>>
        0;
      w[t] = ((w[t - 16]! + s0 + w[t - 7]! + s1) >>> 0) & 0xffffffff;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let t = 0; t < 64; t++) {
      const S1 =
        (((e >>> 6) | (e << 26)) ^
          ((e >>> 11) | (e << 21)) ^
          ((e >>> 25) | (e << 7))) >>>
        0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 = ((h + S1 + ch + K[t]! + w[t]!) >>> 0) & 0xffffffff;
      const S0 =
        (((a >>> 2) | (a << 30)) ^
          ((a >>> 13) | (a << 19)) ^
          ((a >>> 22) | (a << 10))) >>>
        0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = ((S0 + maj) >>> 0) & 0xffffffff;

      h = g;
      g = f;
      f = e;
      e = ((d + temp1) >>> 0) & 0xffffffff;
      d = c;
      c = b;
      b = a;
      a = ((temp1 + temp2) >>> 0) & 0xffffffff;
    }

    h0 = ((h0 + a) >>> 0) & 0xffffffff;
    h1 = ((h1 + b) >>> 0) & 0xffffffff;
    h2 = ((h2 + c) >>> 0) & 0xffffffff;
    h3 = ((h3 + d) >>> 0) & 0xffffffff;
    h4 = ((h4 + e) >>> 0) & 0xffffffff;
    h5 = ((h5 + f) >>> 0) & 0xffffffff;
    h6 = ((h6 + g) >>> 0) & 0xffffffff;
    h7 = ((h7 + h) >>> 0) & 0xffffffff;
  }

  const toHex = (n: number): string => n.toString(16).padStart(8, "0");
  return (
    toHex(h0) +
    toHex(h1) +
    toHex(h2) +
    toHex(h3) +
    toHex(h4) +
    toHex(h5) +
    toHex(h6) +
    toHex(h7)
  );
}

export function derivePromptVersionHash(
  input: PromptVersionInput,
): `sha256:${string}` {
  const canonicalPayload = {
    body: input.body,
    commandKind: input.commandKind,
    key: input.key,
    variables: [...input.variables].sort(),
  };

  const hash = sha256Pure(JSON.stringify(canonicalPayload));
  return `sha256:${hash}`;
}

const ALLOWED_TRANSITIONS: Record<
  PromptVersionStatus,
  ReadonlySet<PromptVersionStatus>
> = {
  draft: new Set(["candidate"]),
  candidate: new Set(["in-experiment", "draft", "retired"]),
  "in-experiment": new Set(["candidate", "retired"]),
  retired: new Set([]),
};

export function transitionPromptVersionStatus(
  current: PromptVersionRecord,
  targetStatus: PromptVersionStatus,
): PromptVersionRecord {
  if (current.status === targetStatus) {
    return current;
  }

  const allowed = ALLOWED_TRANSITIONS[current.status];
  if (!allowed.has(targetStatus)) {
    throw new Error(
      `Illegal status transition from '${current.status}' to '${targetStatus}'.`,
    );
  }

  return {
    ...current,
    status: targetStatus,
  };
}

export function validateExperiment(exp: ExperimentDefinition): void {
  if (exp.variants.length === 0) {
    throw new Error("Experiment must have at least one variant.");
  }

  const totalWeight = exp.variants.reduce((acc, v) => acc + v.weightPct, 0);
  if (totalWeight !== 100) {
    throw new Error(
      `Experiment variant weights must total exactly 100%, but got ${totalWeight}%.`,
    );
  }

  const seenKeys = new Set<string>();
  for (const v of exp.variants) {
    if (seenKeys.has(v.variantKey)) {
      throw new Error(`Duplicate variantKey '${v.variantKey}' in experiment.`);
    }
    seenKeys.add(v.variantKey);
  }
}

export function canPromoteToExperiment(
  prompt: PromptVersionRecord,
  evalResult: EvaluationResult,
): boolean {
  if (prompt.status === "retired") {
    throw new Error("Cannot promote retired prompt version to experiment.");
  }

  if (evalResult.passRate < 1.0) {
    throw new Error(
      `Cannot promote prompt version '${prompt.hash}' to running experiment: requires evaluation grounding pass rate of 100%, but got ${(evalResult.passRate * 100).toFixed(1)}%.`,
    );
  }

  return true;
}

function stringToBucket(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return hash % 100;
}

export function assignExperimentVariant(
  reviewSessionId: string,
  experiment: ExperimentDefinition,
): ExperimentVariant {
  validateExperiment(experiment);

  const bucket = stringToBucket(`${reviewSessionId}:${experiment.id}`);

  let cumulative = 0;
  for (const variant of experiment.variants) {
    cumulative += variant.weightPct;
    if (bucket < cumulative) {
      return variant;
    }
  }

  return experiment.variants[experiment.variants.length - 1]!;
}
