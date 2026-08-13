import { describe, expect, it } from "vitest";

import { PROVIDER_CAPABILITY_MATRIX } from "./provider-registry.js";

describe("TS-13 Provider Registry Guard", () => {
  it("registers all production and testing providers in the capability matrix", () => {
    const knownProviders = Object.keys(PROVIDER_CAPABILITY_MATRIX);

    expect(knownProviders).toContain("fake");
    expect(knownProviders).toContain("openai");
    expect(knownProviders).toContain("anthropic");

    for (const capabilities of Object.values(PROVIDER_CAPABILITY_MATRIX)) {
      expect(capabilities.displayName).toBeDefined();
      expect(typeof capabilities.supportsStructuredOutput).toBe("boolean");
      expect(typeof capabilities.supportsStreaming).toBe("boolean");
      expect(capabilities.maxContextTokens).toBeGreaterThan(0);
    }
  });
});
