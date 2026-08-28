import { GenerationWorkloadDtoSchema } from "@review/contracts/generation";
import { describe, expect, it } from "vitest";

import { createWebBffApp } from "./app.js";
import type {
  ReviewerGenerationContextPort,
  ReviewerGenerationExecutionPort,
} from "./ports/reviewer-generation.port.js";

const allowedPublicSource = {
  sourceRateLimitPort: {
    consume: async () => ({ status: "allowed" as const }),
  },
  resolveTrustedViewerSource: () => "203.0.113.8",
};

const workload = GenerationWorkloadDtoSchema.parse({
  bindings: {
    tenantId: "tenant-a",
    locationId: "location-a",
    reviewSessionId: "review-session-a",
    generationBatchId: "batch-a",
    generationId: "generation-a",
    action: "generate",
    reviewFormatVersionId: "format-concise-v1",
    assertionSetHash: "sha256:assertions",
    requestHash: "sha256:request",
    snapshotId: "snapshot-a",
    snapshotHash: "sha256:snapshot",
    providerModelId: "provider-model-fake",
    priceRateId: "price-rate-fake",
    idempotencyKey: "generation-request-a",
  },
  snapshot: {
    snapshotId: "snapshot-a",
    schemaVersion: 2,
    tenantId: "tenant-a",
    locationId: "location-a",
    tenantName: "Apex Dental",
    locationName: "Central Clinic",
    provenance: {
      locale: { scope: "tenant", sourceId: "tenant-a", revision: "tenant-r1" },
    },
    settings: {
      locale: "en-GB",
      toneGuidelines: "Warm and specific.",
      entryMode: "open-qr",
      requireDisclosure: false,
      requireVerifiedExperience: false,
      maxReviewFormatsPerRequest: 1,
      minimumFactSelections: 1,
      maximumCustomerAssertionChars: 500,
      bannedTerms: [],
      enabledReviewFormatVersionIds: ["format-concise-v1"],
      enabledCommands: ["generate"],
      monthlyBudgetMicros: 0,
      alertThresholdPct: 80,
    },
    factOptions: [],
    reviewFormats: [],
    promptVersions: [],
    priceRates: [
      {
        id: "price-rate-fake",
        providerModelId: "provider-model-fake",
        provider: "fake",
        model: "fake-v1",
        inputPerMillionMicros: 0,
        outputPerMillionMicros: 0,
        currency: "EUR",
        unit: "token",
        effectiveFrom: "2026-08-17T00:00:00.000Z",
        effectiveTo: null,
      },
    ],
    providerRouting: {
      version: "routing-v1",
      providerModelId: "provider-model-fake",
      primaryProvider: "fake",
      primaryModel: "fake-v1",
    },
  },
  command: {
    kind: "generate",
    assertionIds: ["assertion-attentive"],
    rating: 4,
  },
  assertions: [
    {
      id: "assertion-attentive",
      version: "assertion-attentive@1",
      reviewSessionId: "review-session-a",
      semanticId: "attentive-service",
      proposition: "The team was attentive.",
      semanticKind: "experience-fact",
      polarity: "positive",
      source: {
        kind: "fact-option",
        factOptionId: "fact-attentive",
        factOptionVersion: "fact-attentive@1",
      },
    },
  ],
});

function sseData(responseBody: string): unknown[] {
  return responseBody
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)) as unknown);
}

describe("US-01.3 reviewer Generation BFF", () => {
  it("releases a terminal Draft only after activated work is settled", async () => {
    const operations: string[] = [];
    const context: ReviewerGenerationContextPort = {
      async prepare(input) {
        operations.push(`prepare:${input.reviewSessionHandle}`);
        return { status: "prepared", permit: "signed-permit", workload };
      },
      async activate(input) {
        operations.push(`activate:${input.leaseId}`);
        return { status: "activated", activation: "signed-activation" };
      },
      async settle(input) {
        operations.push(`settle:${input.terminalReceipt}`);
        return { status: "settled" };
      },
    };
    const generation: ReviewerGenerationExecutionPort = {
      async prepare() {
        operations.push("generation-prepare");
        return {
          leaseId: "lease-a",
          leaseReceipt: "signed-lease-receipt",
        };
      },
      async *execute() {
        operations.push("generation-execute");
        yield { type: "progress", phase: "validating", elapsedSeconds: 12 };
        yield {
          type: "terminal",
          status: "completed",
          terminalReceipt: "signed-terminal-receipt",
          draft: {
            id: "draft-a",
            generationId: "generation-a",
            revision: 1,
            text: "The team was attentive.",
            systemAnnotations: [],
          },
        };
      },
    };
    const app = createWebBffApp({
      ...allowedPublicSource,
      reviewerGenerationContextPort: context,
      reviewerGenerationExecutionPort: generation,
      publicOrigin: "https://reviews.example.test",
    });
    const body = JSON.stringify({
      factOptionIds: ["fact-attentive"],
      reviewFormatId: "format-concise-v1",
    });

    const response = await app.request(
      "/api/v1/review-sessions/review-session-demo/generations",
      {
        method: "POST",
        headers: {
          Accept: "text/event-stream",
          "Content-Type": "application/json",
          Cookie: "__Host-review_browser=browser-capability-123456789",
          Origin: "https://reviews.example.test",
          "Idempotency-Key": "generation-request-a",
          "x-amz-content-sha256":
            "dce940abe8303c5f5919f83cdb432d18413b30d8458a22cbb447c9f752d61794",
        },
        body,
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    expect(sseData(await response.text())).toEqual([
      { type: "accepted" },
      { type: "progress", phase: "validating", elapsedSeconds: 12 },
      {
        type: "terminal",
        status: "completed",
        draft: {
          id: "draft-a",
          generationId: "generation-a",
          revision: 1,
          text: "The team was attentive.",
          systemAnnotations: [],
        },
      },
    ]);
    expect(operations).toEqual([
      "prepare:review-session-demo",
      "generation-prepare",
      "activate:lease-a",
      "generation-execute",
      "settle:signed-terminal-receipt",
    ]);
  });

  it("streams the application rate-limit wait without invoking Generation", async () => {
    let generationPrepareCalls = 0;
    const context: ReviewerGenerationContextPort = {
      async prepare() {
        return {
          status: "rejected",
          code: "RATE_LIMITED",
          retryable: true,
          retryAfterSeconds: 73,
        };
      },
      async activate() {
        return { status: "rejected" };
      },
      async settle() {
        return { status: "rejected" };
      },
    };
    const generation: ReviewerGenerationExecutionPort = {
      async prepare() {
        generationPrepareCalls += 1;
        throw new Error("Generation must not run for rejected admission");
      },
      async *execute() {
        yield { type: "heartbeat", elapsedSeconds: 0 };
        throw new Error("Generation must not run for rejected admission");
      },
    };
    const app = createWebBffApp({
      ...allowedPublicSource,
      reviewerGenerationContextPort: context,
      reviewerGenerationExecutionPort: generation,
      publicOrigin: "https://reviews.example.test",
    });
    const body = JSON.stringify({
      factOptionIds: ["fact-attentive"],
      reviewFormatId: "format-concise-v1",
    });

    const response = await app.request(
      "/api/v1/review-sessions/review-session-demo/generations",
      {
        method: "POST",
        headers: {
          Accept: "text/event-stream",
          "Content-Type": "application/json",
          Cookie: "__Host-review_browser=browser-capability-123456789",
          Origin: "https://reviews.example.test",
          "Idempotency-Key": "generation-request-rate-limited",
          "x-amz-content-sha256":
            "dce940abe8303c5f5919f83cdb432d18413b30d8458a22cbb447c9f752d61794",
        },
        body,
      },
    );

    expect(response.status).toBe(200);
    expect(sseData(await response.text())).toEqual([
      {
        type: "terminal",
        status: "rejected",
        code: "RATE_LIMITED",
        retryable: true,
        retryAfterSeconds: 73,
      },
    ]);
    expect(generationPrepareCalls).toBe(0);
  });
});
