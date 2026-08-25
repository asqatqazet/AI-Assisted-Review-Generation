import type { PostgresConsoleExecutionProjectionStore } from "@review/db/execution-plane";
import { describe, expect, it } from "vitest";

import { createPostgresConsoleExecutionReader } from "./postgres-console-execution-reader.js";

const rawSecret = "private-provider-output-a";
const detailProjection = {
  status: "generation-detail",
  generation: {
    id: "generation-a",
    createdAt: "2026-08-24T00:00:00.000Z",
    tenant: { id: "tenant-a", slug: "tenant-a", name: "Tenant A" },
    location: { id: "location-a", slug: "location-a", name: "Location A" },
    action: "generate",
    style: { id: "format-a", name: "Concise", version: "1" },
    promptVersion: { id: "prompt-a", version: 1, hash: "sha256:prompt" },
    contextVersion: null,
    inputKeywords: [],
    freeTextAssertions: [],
    sourceText: null,
    provider: "fake",
    model: "fake-v1",
    route: "primary",
    output: "The treatment was explained well.",
    claims: [],
    removedClaims: [],
    cost: { amountMicros: 0, currency: "EUR" },
    pricingVersionId: null,
    outcome: "pending",
    editDistance: null,
    isBench: false,
  },
  lineage: { ancestors: [], descendants: [] },
  replayable: false,
} as const;

const storeWith = (
  audited: unknown,
  redacted: unknown = detailProjection,
): PostgresConsoleExecutionProjectionStore => ({
  readOverview: async () => ({ status: "not-found" }),
  readAnalytics: async () => ({ status: "not-found" }),
  readGenerationDetail: async () => redacted,
  readAuditedGenerationDetail: async () => audited,
  disconnect: async () => undefined,
});

describe("PostgreSQL Console execution reader", () => {
  it("retrieves audit-only Provider evidence but never puts it in the ordinary Console DTO", async () => {
    const reader = createPostgresConsoleExecutionReader(
      storeWith({
        ...detailProjection,
        generation: {
          ...detailProjection.generation,
          providerOutput: { draft: rawSecret, claims: [] },
        },
      }),
    );

    const result = await reader.read({
      authorizationId: "authorization-a",
      view: "generation-detail",
      readMode: "audit",
    });

    expect(result).toEqual(detailProjection);
    expect(JSON.stringify(result)).not.toContain(rawSecret);
  });

  it("rejects Provider output if it appears on the redacted database path", async () => {
    const reader = createPostgresConsoleExecutionReader(
      storeWith(detailProjection, {
        ...detailProjection,
        generation: {
          ...detailProjection.generation,
          providerOutput: { draft: rawSecret },
        },
      }),
    );

    await expect(
      reader.read({
        authorizationId: "authorization-a",
        view: "generation-detail",
        readMode: "redacted",
      }),
    ).rejects.toThrow();
  });
});
