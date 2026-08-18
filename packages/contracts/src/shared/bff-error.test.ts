import { describe, expect, it } from "vitest";

import { BffErrorDtoSchema } from "./bff-error.js";

describe("BFF error contract", () => {
  it("keeps customer-safe diagnostics distinct from field errors and correlation", () => {
    expect(
      BffErrorDtoSchema.parse({
        code: "INVALID_INPUT",
        message: "Check the highlighted fields.",
        retryable: false,
        fieldErrors: { sourceText: ["Source text is required."] },
        requestId: "request-a",
      }),
    ).toEqual({
      code: "INVALID_INPUT",
      message: "Check the highlighted fields.",
      retryable: false,
      fieldErrors: { sourceText: ["Source text is required."] },
      requestId: "request-a",
    });
  });

  it("rejects unknown internal diagnostic fields", () => {
    expect(
      BffErrorDtoSchema.safeParse({
        code: "NOT_FOUND",
        message: "Not found.",
        retryable: false,
        requestId: "request-a",
        tenantId: "must-not-leak",
      }).success,
    ).toBe(false);
  });
});
