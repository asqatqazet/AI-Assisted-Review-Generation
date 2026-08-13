export interface WeightedVariant {
  readonly key: string;
  readonly weightPercent: number;
}

export class ExperimentAssignmentError extends Error {
  public constructor(
    public readonly code:
      | "invalid-variant-weights"
      | "duplicate-variant-key"
      | "invalid-variant-key",
    message: string,
  ) {
    super(message);
    this.name = "ExperimentAssignmentError";
  }
}

function hashToUint32(value: string): number {
  let hash = 1_779_033_703 ^ value.length;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 3_432_918_353);
    hash = (hash << 13) | (hash >>> 19);
  }

  hash = Math.imul(hash ^ (hash >>> 16), 2_246_822_507);
  hash = Math.imul(hash ^ (hash >>> 13), 3_266_489_909);
  return (hash ^ (hash >>> 16)) >>> 0;
}

function validateVariants(variants: readonly WeightedVariant[]): void {
  const keys = new Set<string>();
  let total = 0;

  for (const variant of variants) {
    if (variant.key.length === 0) {
      throw new ExperimentAssignmentError(
        "invalid-variant-key",
        "Experiment Variant keys must not be empty.",
      );
    }
    if (keys.has(variant.key)) {
      throw new ExperimentAssignmentError(
        "duplicate-variant-key",
        `Experiment Variant key ${variant.key} occurs more than once.`,
      );
    }
    keys.add(variant.key);

    if (
      !Number.isSafeInteger(variant.weightPercent) ||
      variant.weightPercent < 0 ||
      variant.weightPercent > 100
    ) {
      throw new ExperimentAssignmentError(
        "invalid-variant-weights",
        "Experiment Variant weights must be integer percentages from 0 to 100.",
      );
    }
    total += variant.weightPercent;
  }

  if (total !== 100) {
    throw new ExperimentAssignmentError(
      "invalid-variant-weights",
      `Experiment Variant weights must total 100; received ${total}.`,
    );
  }
}

/**
 * Selects an initial candidate using weighted rendezvous hashing.
 *
 * The caller must persist the returned assignment for the Review Session;
 * this function intentionally does not pretend recomputation is lifecycle
 * stability after arbitrary weight changes.
 */
export function assignVariant(
  reviewSessionId: string,
  experimentKey: string,
  variants: readonly WeightedVariant[],
): string {
  validateVariants(variants);

  let selectedKey: string | undefined;
  let selectedScore = Number.NEGATIVE_INFINITY;

  for (const variant of variants) {
    if (variant.weightPercent === 0) {
      continue;
    }

    const hash = hashToUint32(
      `${reviewSessionId}:${experimentKey}:${variant.key}`,
    );
    const uniform = (hash + 1) / 4_294_967_297;
    const score = Math.log(uniform) / variant.weightPercent;

    if (
      score > selectedScore ||
      (score === selectedScore &&
        selectedKey !== undefined &&
        variant.key < selectedKey)
    ) {
      selectedKey = variant.key;
      selectedScore = score;
    }
  }

  if (selectedKey === undefined) {
    throw new ExperimentAssignmentError(
      "invalid-variant-weights",
      "At least one Experiment Variant must have positive weight.",
    );
  }

  return selectedKey;
}
