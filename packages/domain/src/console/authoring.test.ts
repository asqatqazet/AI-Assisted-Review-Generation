import { describe, expect, it } from "vitest";

import {
  PriceVersioningError,
  decideExperimentMutation,
  nextPublishedVersion,
  publishPriceRate,
  validateVariantWeights,
} from "./authoring.js";

describe("ADM-AI-04 running experiments are immutable", () => {
  it("permits every configuration change while the experiment is a draft", () => {
    for (const mutation of ["edit-variants", "edit-weights", "edit-action", "start"] as const) {
      expect(decideExperimentMutation({ status: "draft", mutation })).toEqual({
        allowed: true,
      });
    }
  });

  it("permits only stopping once the experiment is running", () => {
    expect(
      decideExperimentMutation({ status: "running", mutation: "stop" }),
    ).toEqual({ allowed: true });

    for (const mutation of ["edit-variants", "edit-weights", "edit-action", "start"] as const) {
      expect(decideExperimentMutation({ status: "running", mutation })).toEqual({
        allowed: false,
        code: "EXPERIMENT_RUNNING",
      });
    }
  });

  it("refuses to reopen a stopped experiment", () => {
    expect(
      decideExperimentMutation({ status: "stopped", mutation: "edit-weights" }),
    ).toEqual({ allowed: false, code: "EXPERIMENT_NOT_DRAFT" });
    expect(
      decideExperimentMutation({ status: "stopped", mutation: "stop" }),
    ).toEqual({ allowed: false, code: "EXPERIMENT_NOT_DRAFT" });
  });

  it("requires variant weights to total exactly 100 across at least two variants", () => {
    expect(
      validateVariantWeights([{ weightPct: 50 }, { weightPct: 50 }]),
    ).toEqual({ allowed: true });
    expect(
      validateVariantWeights([{ weightPct: 60 }, { weightPct: 50 }]),
    ).toEqual({ allowed: false, code: "INVALID_WEIGHTS" });
    expect(validateVariantWeights([{ weightPct: 100 }])).toEqual({
      allowed: false,
      code: "INVALID_WEIGHTS",
    });
  });
});

describe("ADM-PLT-03 provider price versioning", () => {
  const current = {
    id: "price-1",
    provider: "openai",
    model: "model-x",
    currency: "EUR",
    inputMicrosPerMillionTokens: 2_500_000,
    outputMicrosPerMillionTokens: 5_000_000,
    effectiveFromEpochMs: Date.parse("2026-01-01T00:00:00.000Z"),
  };

  it("appends a version and closes the previous one without rewriting it", () => {
    const revision = publishPriceRate({
      existing: [current],
      draft: {
        id: "price-2",
        provider: "openai",
        model: "model-x",
        currency: "EUR",
        inputMicrosPerMillionTokens: 2_800_000,
        outputMicrosPerMillionTokens: 5_400_000,
        effectiveFromEpochMs: Date.parse("2026-08-01T00:00:00.000Z"),
      },
    });

    expect(revision.inserted).toMatchObject({
      id: "price-2",
      inputMicrosPerMillionTokens: 2_800_000,
    });
    expect(revision.closed).toEqual([
      {
        id: "price-1",
        effectiveUntilEpochMs: Date.parse("2026-08-01T00:00:00.000Z"),
      },
    ]);
    expect(current.inputMicrosPerMillionTokens).toBe(2_500_000);
  });

  it("leaves an unrelated model's open interval alone", () => {
    const revision = publishPriceRate({
      existing: [current, { ...current, id: "price-9", model: "model-y" }],
      draft: {
        id: "price-3",
        provider: "openai",
        model: "model-x",
        currency: "EUR",
        inputMicrosPerMillionTokens: 1,
        outputMicrosPerMillionTokens: 1,
        effectiveFromEpochMs: Date.parse("2026-09-01T00:00:00.000Z"),
      },
    });

    expect(revision.closed.map((row) => row.id)).toEqual(["price-1"]);
  });

  it("refuses a version that would start before the current one", () => {
    expect(() =>
      publishPriceRate({
        existing: [current],
        draft: {
          id: "price-4",
          provider: "openai",
          model: "model-x",
          currency: "EUR",
          inputMicrosPerMillionTokens: 1,
          outputMicrosPerMillionTokens: 1,
          effectiveFromEpochMs: Date.parse("2025-12-01T00:00:00.000Z"),
        },
      }),
    ).toThrow(PriceVersioningError);
  });
});

describe("immutable publishing", () => {
  it("publishes the next version rather than reusing the current one", () => {
    expect(nextPublishedVersion([])).toBe(1);
    expect(nextPublishedVersion([{ version: 1 }, { version: 2 }])).toBe(3);
  });
});
