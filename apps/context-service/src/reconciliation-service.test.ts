import { describe, expect, it } from "vitest";

import { createReconciliationService } from "./reconciliation-service.js";

describe("Context reconciliation maintenance", () => {
  it("cleans expired public-source buckets before listing scheduled work", async () => {
    const operations: string[] = [];
    const service = createReconciliationService({
      store: {
        async listReconciliationCandidates() {
          operations.push("list");
          return [];
        },
        async releaseReconciled() {
          return { status: "released" as const };
        },
      },
      authority: { verifyStatus: async () => undefined },
      cleanupPublicSourceRateLimits: async () => {
        operations.push("cleanup");
        return 3;
      },
    });

    await expect(
      service.listReconciliationCandidates({ limit: 25 }),
    ).resolves.toEqual({ candidates: [] });
    expect(operations).toEqual(["cleanup", "list"]);
  });
});
