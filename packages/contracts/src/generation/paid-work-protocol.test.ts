import { describe, expect, it } from "vitest";

import * as generationContracts from "./index.js";
import {
  ExecuteGenerationInvocationDtoSchema,
  GenerationFunctionInvocationDtoSchema,
  GenerationWorkloadDtoSchema,
  PrepareGenerationInvocationDtoSchema,
} from "./generation-request.js";

const snapshot = {
  snapshotId: "snap-01",
  schemaVersion: 1,
  tenantId: "tenant-a",
  locationId: "location-a",
  locale: "en-GB",
  tenantName: "Brightsmile Dental",
  locationName: "Downtown Clinic",
  provenance: {
    locale: { scope: "tenant", sourceId: "tenant-a", revision: "tenant-r7" },
  },
  policy: {
    requireDisclosure: true,
    requireVerifiedExperience: true,
    maxReviewFormatsPerRequest: 1,
    bannedTerms: ["guaranteed"],
  },
  factOptions: [],
  reviewFormats: [],
  promptVersions: [],
  priceRates: [
    {
      id: "price-rate-gemini-test",
      providerModelId: "provider-model-gemini-test",
      provider: "gemini",
      model: "gemini-test",
      inputPerMillionMicros: 0,
      outputPerMillionMicros: 0,
      currency: "EUR",
      unit: "token",
      effectiveFrom: "2026-08-01T00:00:00.000Z",
      effectiveTo: null,
    },
  ],
  providerRouting: {
    version: "routing-v1",
    providerModelId: "provider-model-gemini-test",
    primaryProvider: "gemini",
    primaryModel: "gemini-test",
  },
};

const workload = {
  bindings: {
    tenantId: "tenant-a",
    locationId: "location-a",
    reviewSessionId: "session-a",
    generationBatchId: "batch-a",
    generationId: "generation-a",
    action: "generate",
    reviewFormatVersionId: "format-a@1",
    assertionSetHash: "sha256:assertions",
    requestHash: "sha256:request",
    snapshotId: "snap-01",
    snapshotHash: "sha256:snapshot",
    providerModelId: "provider-model-gemini-test",
    priceRateId: "price-rate-gemini-test",
    idempotencyKey: "request-1",
  },
  snapshot,
  command: {
    kind: "generate",
    assertionIds: ["assertion-a"],
    rating: 5,
  },
};

describe("ADR-005 paid-work Generation contract", () => {
  it("carries normalized Assertions needed to prepare and ground the provider request", () => {
    const groundedWorkload = {
      ...workload,
      assertions: [
        {
          id: "assertion-a",
          version: "assertion-a@1",
          reviewSessionId: "session-a",
          semanticId: "service-explained-clearly",
          semanticKind: "experience-fact",
          polarity: "positive",
          source: {
            kind: "reviewer-text",
            sourceRevisionId: "source-revision-a",
            start: 0,
            end: 30,
            quotedText: "The treatment was explained well.",
          },
        },
      ],
    };

    expect(GenerationWorkloadDtoSchema.parse(groundedWorkload).assertions).toEqual(
      groundedWorkload.assertions,
    );
  });

  it("prepares one fully bound child Generation without calling a provider", () => {
    expect(
      PrepareGenerationInvocationDtoSchema.parse({
        operation: "prepare",
        permit: "signed-context-permit",
        workload,
      }),
    ).toMatchObject({
      operation: "prepare",
      workload: {
        bindings: {
          generationId: "generation-a",
          reviewFormatVersionId: "format-a@1",
        },
        snapshot: { snapshotId: "snap-01" },
      },
    });
  });

  it("executes only the same full workload with a lease and activation", () => {
    expect(
      ExecuteGenerationInvocationDtoSchema.parse({
        operation: "execute",
        leaseId: "lease-a",
        activation: "signed-context-activation",
        workload,
      }),
    ).toMatchObject({
      operation: "execute",
      leaseId: "lease-a",
      workload: { bindings: { generationId: "generation-a" } },
    });

    expect(
      ExecuteGenerationInvocationDtoSchema.safeParse({
        operation: "execute",
        leaseId: "lease-a",
        workload,
      }).success,
    ).toBe(false);
  });

  it("rejects lookup-only configuration and mismatched workload bindings", () => {
    expect(
      PrepareGenerationInvocationDtoSchema.safeParse({
        operation: "prepare",
        permit: "signed-context-permit",
        workload: {
          ...workload,
          snapshot: undefined,
          snapshotId: "snap-01",
        },
      }).success,
    ).toBe(false);

    expect(
      PrepareGenerationInvocationDtoSchema.safeParse({
        operation: "prepare",
        permit: "signed-context-permit",
        workload: {
          ...workload,
          bindings: { ...workload.bindings, tenantId: "tenant-b" },
        },
      }).success,
    ).toBe(false);

    expect(
      PrepareGenerationInvocationDtoSchema.safeParse({
        operation: "prepare",
        permit: "signed-context-permit",
        workload: {
          ...workload,
          bindings: {
            ...workload.bindings,
            priceRateId: "price-rate-not-in-snapshot",
          },
        },
      }).success,
    ).toBe(false);
  });

  it("exposes explicit status and expired-lease cancellation operations", () => {
    const scope = {
      tenantId: "tenant-a",
      locationId: "location-a",
      reviewSessionId: "session-a",
      generationBatchId: "batch-a",
      generationId: "generation-a",
      permitJti: "permit-jti-a",
    };

    expect(
      GenerationFunctionInvocationDtoSchema.parse({
        operation: "status",
        scope,
      }),
    ).toEqual({ operation: "status", scope });
    expect(
      GenerationFunctionInvocationDtoSchema.parse({
        operation: "cancel-expired-lease",
        leaseId: "lease-a",
        scope,
      }),
    ).toEqual({ operation: "cancel-expired-lease", leaseId: "lease-a", scope });
  });

  it("removes the superseded one-shot request from the public package", () => {
    expect(generationContracts).not.toHaveProperty("GenerateRequestDtoSchema");
  });
});
