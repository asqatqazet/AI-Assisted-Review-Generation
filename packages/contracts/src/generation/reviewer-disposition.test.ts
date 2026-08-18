import { describe, expect, it } from "vitest";

import {
  RecordReviewerDispositionInvocationDtoSchema,
  ReviewerDispositionCommandDtoSchema,
  ReviewerDispositionScopeDtoSchema,
} from "./index.js";
import { PrepareReviewerDispositionInvocationDtoSchema } from "../context/index.js";

describe("US-03.6 reviewer Draft disposition contracts", () => {
  const command = {
    draftId: "draft-a",
    generationId: "generation-a",
    finalText: "The team was exceptionally attentive.",
  };
  const scope = {
    tenantId: "tenant-a",
    locationId: "location-a",
    reviewSessionId: "review-session-a",
    draftId: "draft-a",
    generationId: "generation-a",
    finalTextHash: `sha256:${"a".repeat(64)}`,
    idempotencyKey: "disposition-a",
  };

  it("accepts reviewer text without accepting caller-selected scope", () => {
    expect(ReviewerDispositionCommandDtoSchema.parse(command)).toEqual(command);
    expect(() =>
      ReviewerDispositionCommandDtoSchema.parse({
        ...command,
        tenantId: "attacker-selected-tenant",
      }),
    ).toThrow();
    expect(() =>
      ReviewerDispositionCommandDtoSchema.parse({ ...command, finalText: "   " }),
    ).toThrow();
  });

  it("binds Context authorization to the browser session, exact text hash and idempotency key", () => {
    expect(
      PrepareReviewerDispositionInvocationDtoSchema.parse({
        operation: "prepare-reviewer-disposition",
        input: {
          reviewSessionHandle: "review-session-handle",
          browserCapability: "browser-capability-123456789",
          idempotencyKey: "disposition-a",
          draftId: command.draftId,
          generationId: command.generationId,
          finalTextHash: scope.finalTextHash,
        },
      }),
    ).toBeDefined();
    expect(ReviewerDispositionScopeDtoSchema.parse(scope)).toEqual(scope);
  });

  it("requires the private Generation invocation to carry the signed scope and exact text", () => {
    expect(
      RecordReviewerDispositionInvocationDtoSchema.parse({
        operation: "record-reviewer-disposition",
        permit: "signed-disposition-permit",
        scope,
        finalText: command.finalText,
      }),
    ).toBeDefined();
  });
});
