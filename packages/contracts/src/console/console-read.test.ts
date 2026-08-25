import { describe, expect, it } from "vitest";

import { ConsoleReadInvocationDtoSchema } from "./console-read.js";

describe("Console execution read courier contract", () => {
  it("carries only the signed receipt and opaque database authorization id", () => {
    expect(
      ConsoleReadInvocationDtoSchema.safeParse({
        operation: "console-read",
        input: {
          receipt: "context-signed-receipt",
          authorizationId: "2ffad1ca-22f2-41ad-a9b3-07991a66cf76",
        },
      }).success,
    ).toBe(true);

    expect(
      ConsoleReadInvocationDtoSchema.safeParse({
        operation: "console-read",
        input: {
          receipt: "context-signed-receipt",
          authorizationId: "2ffad1ca-22f2-41ad-a9b3-07991a66cf76",
          tenantIds: ["tenant-b"],
          mayReadRawCandidates: true,
        },
      }).success,
    ).toBe(false);
  });
});
