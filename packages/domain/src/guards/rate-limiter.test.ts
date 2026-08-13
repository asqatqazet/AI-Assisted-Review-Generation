import { describe, expect, it } from "vitest";

import {
  evaluateRateLimit,
  type RateLimitInput,
} from "./rate-limiter.js";

describe("TS-20 Rate Limiter", () => {
  it("allows request when under sliding window limit", () => {
    const now = 100_000;
    const input: RateLimitInput = {
      windowSeconds: 60,
      maxRequests: 5,
      requestTimestamps: [95_000, 96_000, 98_000],
      now,
    };

    const result = evaluateRateLimit(input);
    expect(result.allow).toBe(true);
    if (result.allow) {
      expect(result.remaining).toBe(1); // 5 - 4 (including current)
    }
  });

  it("denies request and returns retryAfterSeconds when sliding window limit reached", () => {
    const now = 100_000;
    const input: RateLimitInput = {
      windowSeconds: 60,
      maxRequests: 3,
      requestTimestamps: [50_000, 60_000, 70_000], // all within 60s window (40k..100k)
      now,
    };

    const result = evaluateRateLimit(input);
    expect(result.allow).toBe(false);
    if (!result.allow) {
      expect(result.retryAfterSeconds).toBe(10); // 50_000 + 60_000 - 100_000 = 10s
    }
  });

  it("evicts timestamps outside sliding window", () => {
    const now = 100_000;
    const input: RateLimitInput = {
      windowSeconds: 60,
      maxRequests: 3,
      requestTimestamps: [20_000, 30_000, 80_000], // 20k and 30k are older than 40k
      now,
    };

    const result = evaluateRateLimit(input);
    expect(result.allow).toBe(true);
    if (result.allow) {
      expect(result.remaining).toBe(1); // 3 - (1 active + 1 current) = 1
    }
  });
});
