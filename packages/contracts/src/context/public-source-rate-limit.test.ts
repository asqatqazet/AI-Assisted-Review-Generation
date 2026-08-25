import { describe, expect, it } from "vitest";

import {
  ConsumePublicSourceRateLimitInvocationDtoSchema,
  ConsumePublicSourceRateLimitInvocationResultDtoSchema,
  ReviewerContextFunctionInvocationDtoSchema,
} from "./index.js";

describe("public source rate-limit wire contract", () => {
  it("admits only a fixed policy key and a valid source address", () => {
    const invocation = {
      operation: "consume-public-source-rate-limit",
      input: {
        policy: "entry-start",
        sourceAddress: "2001:db8::8",
      },
    } as const;

    expect(ConsumePublicSourceRateLimitInvocationDtoSchema.parse(invocation)).toEqual(
      invocation,
    );
    expect(ReviewerContextFunctionInvocationDtoSchema.parse(invocation)).toEqual(
      invocation,
    );
    expect(
      ConsumePublicSourceRateLimitInvocationDtoSchema.safeParse({
        ...invocation,
        input: { ...invocation.input, limit: 1000, windowSeconds: 1 },
      }).success,
    ).toBe(false);
    expect(
      ConsumePublicSourceRateLimitInvocationDtoSchema.safeParse({
        ...invocation,
        input: { ...invocation.input, sourceAddress: "not-an-ip" },
      }).success,
    ).toBe(false);
  });

  it("returns only an allow or a generic retry delay", () => {
    expect(
      ConsumePublicSourceRateLimitInvocationResultDtoSchema.parse({
        operation: "consume-public-source-rate-limit",
        result: { status: "allowed" },
      }),
    ).toEqual({
      operation: "consume-public-source-rate-limit",
      result: { status: "allowed" },
    });
    expect(
      ConsumePublicSourceRateLimitInvocationResultDtoSchema.parse({
        operation: "consume-public-source-rate-limit",
        result: { status: "limited", retryAfterSeconds: 73 },
      }),
    ).toEqual({
      operation: "consume-public-source-rate-limit",
      result: { status: "limited", retryAfterSeconds: 73 },
    });
  });
});
