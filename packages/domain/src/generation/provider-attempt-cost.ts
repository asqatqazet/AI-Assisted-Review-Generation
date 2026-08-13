export interface PriceRate {
  readonly id: string;
  readonly provider: string;
  readonly model: string;
  readonly currency: string;
  readonly inputMicrosPerMillionTokens: number;
  readonly outputMicrosPerMillionTokens: number;
  readonly effectiveFromEpochMs: number;
  readonly effectiveUntilEpochMs?: number;
}

export interface ProviderAttemptCost {
  readonly priceRateId: string;
  readonly currency: string;
  readonly unit: "micro";
  readonly amountMicros: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export class ProviderAttemptCostError extends Error {
  public constructor(
    public readonly code:
      | "price-rate-mismatch"
      | "price-rate-not-effective"
      | "price-rate-not-found"
      | "ambiguous-price-rate"
      | "invalid-price-rate"
      | "invalid-token-usage"
      | "cost-overflow",
    message: string,
  ) {
    super(message);
    this.name = "ProviderAttemptCostError";
  }
}

interface CostInput {
  readonly provider: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly billedAtEpochMs: number;
}

function isEffective(rate: PriceRate, billedAtEpochMs: number): boolean {
  return (
    rate.effectiveFromEpochMs <= billedAtEpochMs &&
    (rate.effectiveUntilEpochMs === undefined ||
      billedAtEpochMs < rate.effectiveUntilEpochMs)
  );
}

function requireSafeNonNegativeInteger(
  value: number,
  code: "invalid-price-rate" | "invalid-token-usage",
  label: string,
): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ProviderAttemptCostError(
      code,
      `${label} must be a non-negative safe integer.`,
    );
  }
}

function validateUsage(input: CostInput): void {
  requireSafeNonNegativeInteger(
    input.inputTokens,
    "invalid-token-usage",
    "Input token usage",
  );
  requireSafeNonNegativeInteger(
    input.outputTokens,
    "invalid-token-usage",
    "Output token usage",
  );
}

function validateRate(rate: PriceRate): void {
  requireSafeNonNegativeInteger(
    rate.inputMicrosPerMillionTokens,
    "invalid-price-rate",
    "Input Price Rate",
  );
  requireSafeNonNegativeInteger(
    rate.outputMicrosPerMillionTokens,
    "invalid-price-rate",
    "Output Price Rate",
  );
  if (
    !Number.isSafeInteger(rate.effectiveFromEpochMs) ||
    (rate.effectiveUntilEpochMs !== undefined &&
      (!Number.isSafeInteger(rate.effectiveUntilEpochMs) ||
        rate.effectiveUntilEpochMs <= rate.effectiveFromEpochMs))
  ) {
    throw new ProviderAttemptCostError(
      "invalid-price-rate",
      `Price Rate ${rate.id} has an invalid effective interval.`,
    );
  }
}

export function computeCostMicros(
  input: CostInput & { readonly priceRow: PriceRate },
): number {
  validateUsage(input);
  validateRate(input.priceRow);

  if (
    input.priceRow.provider !== input.provider ||
    input.priceRow.model !== input.model
  ) {
    throw new ProviderAttemptCostError(
      "price-rate-mismatch",
      `Price Rate ${input.priceRow.id} does not price ${input.provider}/${input.model}.`,
    );
  }
  if (!isEffective(input.priceRow, input.billedAtEpochMs)) {
    throw new ProviderAttemptCostError(
      "price-rate-not-effective",
      `Price Rate ${input.priceRow.id} was not effective at billing time.`,
    );
  }

  const numerator =
    BigInt(input.inputTokens) *
      BigInt(input.priceRow.inputMicrosPerMillionTokens) +
    BigInt(input.outputTokens) *
      BigInt(input.priceRow.outputMicrosPerMillionTokens);
  const roundedMicros = (numerator + 500_000n) / 1_000_000n;

  if (roundedMicros > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ProviderAttemptCostError(
      "cost-overflow",
      "Provider Attempt cost exceeds the safe integer range.",
    );
  }

  return Number(roundedMicros);
}

export function costProviderAttempt(
  input: CostInput & { readonly priceRates: readonly PriceRate[] },
): ProviderAttemptCost {
  validateUsage(input);

  const matchingRates = input.priceRates.filter((rate) => {
    validateRate(rate);
    return (
      rate.provider === input.provider &&
      rate.model === input.model &&
      isEffective(rate, input.billedAtEpochMs)
    );
  });

  if (matchingRates.length === 0) {
    throw new ProviderAttemptCostError(
      "price-rate-not-found",
      `No Price Rate exists for ${input.provider}/${input.model} at billing time.`,
    );
  }
  if (matchingRates.length > 1) {
    throw new ProviderAttemptCostError(
      "ambiguous-price-rate",
      `Multiple Price Rates cover ${input.provider}/${input.model} at billing time.`,
    );
  }

  const priceRow = matchingRates[0];
  if (priceRow === undefined) {
    throw new ProviderAttemptCostError(
      "price-rate-not-found",
      "No effective Price Rate was selected.",
    );
  }

  return {
    priceRateId: priceRow.id,
    currency: priceRow.currency,
    unit: "micro",
    amountMicros: computeCostMicros({ ...input, priceRow }),
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
  };
}
