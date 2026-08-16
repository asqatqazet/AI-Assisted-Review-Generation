import { describe, expect, it } from "vitest";

import * as llm from "./index.js";

describe("US-05.2 funded provider public API", () => {
  it("does not expose an automatic retry or provider-failover gateway", () => {
    expect(llm).not.toHaveProperty("ResilientModelGateway");
  });
});
