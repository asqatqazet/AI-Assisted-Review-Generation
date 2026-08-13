import { describe, expect, it } from "vitest";

import {
  computeCostMicros,
  costProviderAttempt,
  type PriceRate,
} from "./provider-attempt-cost.js";

const januaryRate: PriceRate = {
  id: "rate-model-a-2026-01",
  provider: "provider-a",
  model: "model-a",
  currency: "EUR",
  inputMicrosPerMillionTokens: 2_000_000,
  outputMicrosPerMillionTokens: 6_000_000,
  effectiveFromEpochMs: Date.UTC(2026, 0, 1),
  effectiveUntilEpochMs: Date.UTC(2026, 1, 1),
};

const februaryRate: PriceRate = {
  ...januaryRate,
  id: "rate-model-a-2026-02",
  inputMicrosPerMillionTokens: 3_000_000,
  outputMicrosPerMillionTokens: 9_000_000,
  effectiveFromEpochMs: Date.UTC(2026, 1, 1),
  effectiveUntilEpochMs: Date.UTC(2026, 2, 1),
};

describe("computeCostMicros", () => {
  it("computes with integer micros and rounds the total half up", () => {
    expect(
      computeCostMicros({
        provider: "provider-a",
        model: "model-a",
        inputTokens: 333,
        outputTokens: 111,
        billedAtEpochMs: Date.UTC(2026, 0, 15),
        priceRow: januaryRate,
      }),
    ).toBe(1_332);
  });

  it("rejects a mismatched model instead of recording zero cost", () => {
    expect(() =>
      computeCostMicros({
        provider: "provider-a",
        model: "unknown-model",
        inputTokens: 100,
        outputTokens: 100,
        billedAtEpochMs: Date.UTC(2026, 0, 15),
        priceRow: januaryRate,
      }),
    ).toThrowError(expect.objectContaining({ code: "price-rate-mismatch" }));
  });

  it("rejects a rate outside its effective interval", () => {
    expect(() =>
      computeCostMicros({
        provider: "provider-a",
        model: "model-a",
        inputTokens: 100,
        outputTokens: 100,
        billedAtEpochMs: Date.UTC(2026, 1, 15),
        priceRow: januaryRate,
      }),
    ).toThrowError(expect.objectContaining({ code: "price-rate-not-effective" }));
  });
});

describe("costProviderAttempt", () => {
  it("selects the immutable rate effective at billing time", () => {
    const cost = costProviderAttempt({
      provider: "provider-a",
      model: "model-a",
      inputTokens: 1_000,
      outputTokens: 500,
      billedAtEpochMs: Date.UTC(2026, 0, 31, 23, 59),
      priceRates: [februaryRate, januaryRate],
    });

    expect(cost).toEqual({
      priceRateId: "rate-model-a-2026-01",
      currency: "EUR",
      unit: "micro",
      amountMicros: 5_000,
      inputTokens: 1_000,
      outputTokens: 500,
    });
  });

  it("uses a half-open interval at a superseding rate boundary", () => {
    const cost = costProviderAttempt({
      provider: "provider-a",
      model: "model-a",
      inputTokens: 1_000,
      outputTokens: 0,
      billedAtEpochMs: Date.UTC(2026, 1, 1),
      priceRates: [januaryRate, februaryRate],
    });

    expect(cost.priceRateId).toBe("rate-model-a-2026-02");
    expect(cost.amountMicros).toBe(3_000);
  });

  it("raises when no Price Rate exists for a provider-qualified model", () => {
    expect(() =>
      costProviderAttempt({
        provider: "provider-b",
        model: "model-a",
        inputTokens: 100,
        outputTokens: 100,
        billedAtEpochMs: Date.UTC(2026, 0, 15),
        priceRates: [januaryRate, februaryRate],
      }),
    ).toThrowError(expect.objectContaining({ code: "price-rate-not-found" }));
  });

  it("raises when overlapping rates make billing ambiguous", () => {
    expect(() =>
      costProviderAttempt({
        provider: "provider-a",
        model: "model-a",
        inputTokens: 100,
        outputTokens: 100,
        billedAtEpochMs: Date.UTC(2026, 0, 15),
        priceRates: [januaryRate, { ...januaryRate, id: "overlap" }],
      }),
    ).toThrowError(expect.objectContaining({ code: "ambiguous-price-rate" }));
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects an invalid token quantity %s",
    (inputTokens) => {
      expect(() =>
        costProviderAttempt({
          provider: "provider-a",
          model: "model-a",
          inputTokens,
          outputTokens: 1,
          billedAtEpochMs: Date.UTC(2026, 0, 15),
          priceRates: [januaryRate],
        }),
      ).toThrowError(expect.objectContaining({ code: "invalid-token-usage" }));
    },
  );
});
