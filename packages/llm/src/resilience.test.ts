import { describe, expect, it } from "vitest";

import { CircuitBreaker } from "./circuit-breaker.js";

describe("TS-13 CircuitBreaker", () => {
  it("starts in closed state and remains closed on success", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 100 });
    expect(breaker.state).toBe("closed");

    const result = await breaker.execute(() => Promise.resolve("ok"));
    expect(result).toBe("ok");
    expect(breaker.state).toBe("closed");
  });

  it("opens after reaching consecutive failure threshold", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 50 });

    await expect(breaker.execute(() => Promise.reject(new Error("fail 1")))).rejects.toThrow();
    expect(breaker.state).toBe("closed");

    await expect(breaker.execute(() => Promise.reject(new Error("fail 2")))).rejects.toThrow();
    expect(breaker.state).toBe("open");

    // Rejects immediately while open without executing operation
    await expect(breaker.execute(() => Promise.resolve("ok"))).rejects.toThrowError(
      /circuit breaker is open/i,
    );
  });

  it("transitions to half-open after reset timeout and closes on successful probe", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 20 });

    await expect(breaker.execute(() => Promise.reject(new Error("fail")))).rejects.toThrow();
    expect(breaker.state).toBe("open");

    // Wait for cooldown
    await new Promise((resolve) => setTimeout(resolve, 30));

    const result = await breaker.execute(() => Promise.resolve("recovered"));
    expect(result).toBe("recovered");
    expect(breaker.state).toBe("closed");
  });
});
