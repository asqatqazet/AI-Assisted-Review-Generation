import { describe, expect, it } from "vitest";

import { createWebBffApp } from "./app.js";
import {
  cloudFrontViewerSource,
  type PublicSourceRateLimitPort,
} from "./ports/public-source-rate-limit.port.js";
import type { ContextPort } from "./ports/context.port.js";

const contextPort: ContextPort = {
  prepareEntry: async () => ({
    status: "prepared",
    entryChallengeHandle: "entry-challenge-a",
  }),
  readEntryChallenge: async () => ({ status: "unavailable" }),
  advanceEntry: async () => ({ status: "unavailable" }),
  readReviewSession: async () => ({ status: "unavailable" }),
};

describe("public HTTP source limits", () => {
  it("uses the rightmost valid CloudFront-forwarded address, never a spoofable left entry", async () => {
    const consumed: unknown[] = [];
    const sourceRateLimitPort: PublicSourceRateLimitPort = {
      async consume(input) {
        consumed.push(input);
        return { status: "allowed" };
      },
    };
    const app = createWebBffApp({
      contextPort,
      sourceRateLimitPort,
      resolveTrustedViewerSource: cloudFrontViewerSource,
      newBrowserCapability: () => "opaque-browser-capability",
    });

    const response = await app.request("/s/apex-dental/central", {
      headers: {
        "X-Forwarded-For":
          "198.51.100.91, deliberately-spoofed, 2001:db8:0:0:0:0:0:8",
      },
    });

    expect(response.status).toBe(303);
    expect(consumed).toEqual([
      {
        policy: "entry-prepare",
        sourceAddress: "2001:db8::",
      },
    ]);
  });

  it("buckets IPv6 viewers by /64 and normalizes mapped IPv4", () => {
    const source = (candidate: string) =>
      cloudFrontViewerSource(
        new Headers({ "X-Forwarded-For": candidate }),
      );

    expect(source("2001:db8:1234:5678::1")).toBe(
      "2001:db8:1234:5678::",
    );
    expect(source("2001:db8:1234:5678:ffff:ffff:ffff:ffff")).toBe(
      "2001:db8:1234:5678::",
    );
    expect(source("2001:db8:1234:5679::1")).toBe(
      "2001:db8:1234:5679::",
    );
    expect(source("::ffff:192.0.2.1")).toBe("192.0.2.1");
    expect(source("::ffff:c000:201")).toBe("192.0.2.1");
  });

  it("fails closed instead of falling back to a valid spoofed address on the left", async () => {
    expect(
      cloudFrontViewerSource(
        new Headers({
          "X-Forwarded-For": "198.51.100.91, invalid-cloudfront-value",
        }),
      ),
    ).toBeNull();
  });

  it("fails closed when the trusted source or Context limiter is missing", async () => {
    const neverCalled: PublicSourceRateLimitPort = {
      consume: async () => {
        throw new Error("missing source must not reach Context");
      },
    };
    const withoutSource = createWebBffApp({
      contextPort,
      sourceRateLimitPort: neverCalled,
      resolveTrustedViewerSource: cloudFrontViewerSource,
      newRequestId: () => "request-source-missing",
    });
    const withoutPort = createWebBffApp({
      contextPort,
      resolveTrustedViewerSource: cloudFrontViewerSource,
      newRequestId: () => "request-port-missing",
    });

    for (const response of [
      await withoutSource.request("/s/apex-dental/central"),
      await withoutPort.request("/s/apex-dental/central", {
        headers: { "X-Forwarded-For": "203.0.113.8" },
      }),
    ]) {
      expect(response.status).toBe(429);
      expect(response.headers.get("retry-after")).toBe("60");
      await expect(response.json()).resolves.toMatchObject({
        code: "EDGE_THROTTLED",
        retryable: true,
      });
    }
  });

  it.each([
    ["entry preparation", "/s/apex-dental/central", "GET"],
    [
      "entry Start",
      "/api/v1/entry-challenges/challenge-a/start",
      "POST",
    ],
    [
      "reviewer Generation",
      "/api/v1/review-sessions/session-a/generations",
      "POST",
    ],
  ] as const)(
    "returns generic 429 before heavy %s work",
    async (_name, path, method) => {
      const consumed: unknown[] = [];
      const sourceRateLimitPort: PublicSourceRateLimitPort = {
        async consume(input) {
          consumed.push(input);
          return { status: "limited", retryAfterSeconds: 137 };
        },
      };
      const app = createWebBffApp({
        contextPort,
        sourceRateLimitPort,
        resolveTrustedViewerSource: cloudFrontViewerSource,
        publicOrigin: "https://review.example.test",
        newRequestId: () => "request-rate-limited",
      });

      const response = await app.request(path, {
        method,
        headers: {
          "X-Forwarded-For": "192.0.2.8, 203.0.113.8",
          Origin: "https://review.example.test",
          Cookie: "__Host-review_browser=opaque-browser-capability",
        },
        ...(method === "POST"
          ? { body: "this body must not be parsed" }
          : {}),
      });

      expect(response.status).toBe(429);
      expect(response.headers.get("retry-after")).toBe("137");
      await expect(response.json()).resolves.toEqual({
        code: "EDGE_THROTTLED",
        message: "Please wait before trying again.",
        retryable: true,
        requestId: "request-rate-limited",
      });
      expect(consumed).toEqual([
        {
          policy:
            method === "GET"
              ? "entry-prepare"
              : path.endsWith("/start")
                ? "entry-start"
                : "generation",
          sourceAddress: "203.0.113.8",
        },
      ]);
    },
  );
});
