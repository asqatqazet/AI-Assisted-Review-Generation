import { describe, expect, it } from "vitest";

import { ConsoleConfigurationDraftChangeDtoSchema } from "./configuration-draft.js";

describe("Tenant Configuration Draft Prompt deployment", () => {
  it("binds the immutable Action and rejects the pre-action wire shape", () => {
    expect(
      ConsoleConfigurationDraftChangeDtoSchema.safeParse({
        operation: "deploy-prompt-version",
        promptVersionId: "prompt-generate-v2",
      }).success,
    ).toBe(false);
    expect(
      ConsoleConfigurationDraftChangeDtoSchema.parse({
        operation: "deploy-prompt-version",
        action: "generate",
        promptVersionId: "prompt-generate-v2",
      }),
    ).toEqual({
      operation: "deploy-prompt-version",
      action: "generate",
      promptVersionId: "prompt-generate-v2",
    });
  });
});
