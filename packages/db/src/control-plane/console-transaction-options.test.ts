import { describe, expect, it } from "vitest";

import { consoleTransactionOptions } from "./console-transaction-options.js";

describe("Console transaction options", () => {
  it("keeps atomic remote-Neon publication alive beyond Prisma's five-second default", () => {
    expect(consoleTransactionOptions).toEqual({
      maxWait: 10_000,
      timeout: 30_000,
    });
  });
});
