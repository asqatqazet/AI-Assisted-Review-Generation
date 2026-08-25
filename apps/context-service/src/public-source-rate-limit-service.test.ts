import { describe, expect, it } from "vitest";

import {
  createPublicSourceRateLimitService,
  type PublicSourceRateLimitStore,
} from "./public-source-rate-limit-service.js";

describe("Context public source rate limiter", () => {
  it("daily-HMACs the source before the persistence boundary", async () => {
    const consumed: unknown[] = [];
    const store: PublicSourceRateLimitStore = {
      async consume(input) {
        consumed.push(input);
        return { status: "allowed" };
      },
    };
    const service = createPublicSourceRateLimitService({
      secret: "0123456789abcdef0123456789abcdef",
      store,
      now: () => new Date("2026-08-24T23:59:59.999Z"),
    });

    await expect(
      service.consume({
        policy: "entry-start",
        sourceAddress: "203.0.113.8",
      }),
    ).resolves.toEqual({ status: "allowed" });
    expect(consumed).toEqual([
      {
        policy: "entry-start",
        currentSourceBucketHash:
          "69bb1b63d1ba21158b73e0259ac07f18aa6f173f93a550afa89cfbbee7d05783",
        previousSourceBucketHash:
          "226752d93f74499094e73838286b5a3c6ba8c076ebe43b2fc8da40e05747bc1f",
        nextSourceBucketHash:
          "dc1e9d4f1258acd3ab6e546254d3f66f9d44e12ed488b2cb339f6f6521ad201d",
      },
    ]);
    expect(JSON.stringify(consumed)).not.toContain("203.0.113.8");
  });

  it("rotates the source bucket at the UTC day boundary", async () => {
    const buckets: unknown[] = [];
    let now = new Date("2026-08-24T23:59:59.999Z");
    const service = createPublicSourceRateLimitService({
      secret: "0123456789abcdef0123456789abcdef",
      store: {
        async consume(input) {
          buckets.push(input);
          return { status: "allowed" };
        },
      },
      now: () => now,
    });

    await service.consume({
      policy: "generation",
      sourceAddress: "203.0.113.8",
    });
    now = new Date("2026-08-25T00:00:00.000Z");
    await service.consume({
      policy: "generation",
      sourceAddress: "203.0.113.8",
    });

    expect(buckets).toEqual([
      {
        policy: "generation",
        currentSourceBucketHash:
          "13d380bdf79b5fedec91038be5b1ea289db0d9413b0804ebe9d7310adbdc1952",
        previousSourceBucketHash:
          "b2ec5ab1f2c1ce4c9aa83ae6e540b743bd2d5189f5041d4d2768dbca40fcdb8d",
        nextSourceBucketHash:
          "35f1ad38dbd3bd19b963d64dca09ce35540cd09cdf2e3f108f6d58da9e7e7903",
      },
      {
        policy: "generation",
        currentSourceBucketHash:
          "35f1ad38dbd3bd19b963d64dca09ce35540cd09cdf2e3f108f6d58da9e7e7903",
        previousSourceBucketHash:
          "13d380bdf79b5fedec91038be5b1ea289db0d9413b0804ebe9d7310adbdc1952",
        nextSourceBucketHash:
          "f03fb439a1f6b23c163c5babc52f4bebb9a8acea1359ece464e1e0f7ba5cef2e",
      },
    ]);
  });

  it("does not expose a cross-policy correlation key for one source", async () => {
    const currentHashes: string[] = [];
    const previousHashes: string[] = [];
    const nextHashes: string[] = [];
    const service = createPublicSourceRateLimitService({
      secret: "0123456789abcdef0123456789abcdef",
      store: {
        async consume(input) {
          currentHashes.push(input.currentSourceBucketHash);
          previousHashes.push(input.previousSourceBucketHash);
          nextHashes.push(input.nextSourceBucketHash);
          return { status: "allowed" };
        },
      },
      now: () => new Date("2026-08-24T12:00:00.000Z"),
    });

    await service.consume({
      policy: "entry-start",
      sourceAddress: "203.0.113.8",
    });
    await service.consume({
      policy: "generation",
      sourceAddress: "203.0.113.8",
    });

    expect(new Set(currentHashes).size).toBe(2);
    expect(new Set(previousHashes).size).toBe(2);
    expect(new Set(nextHashes).size).toBe(2);
  });

  it("rejects a weak secret before accepting traffic", () => {
    expect(() =>
      createPublicSourceRateLimitService({
        secret: "too-short",
        store: { consume: async () => ({ status: "allowed" }) },
      }),
    ).toThrow("at least 32 bytes");
  });
});
