import { describe, expect, it } from "vitest";

import {
  GenerationFunctionInvocationDtoSchema,
  RecordReviewerDraftRevisionInvocationDtoSchema,
  RecordReviewerDraftRevisionResultDtoSchema,
  ReviewerDraftRevisionCommandDtoSchema,
} from "./index.js";

const textHash = `sha256:${"a".repeat(64)}`;
const scope = {
  tenantId: "tenant-a",
  locationId: "location-a",
  reviewSessionId: "review-session-a",
  draftId: "draft-a",
  generationId: "generation-a",
  expectedRevision: 1,
  textHash,
  idempotencyKey: "draft-save-a",
};

describe("US-02.3 reviewer Draft revision contract", () => {
  it("binds an autosave to one immutable Draft revision without recording a Disposition", () => {
    expect(
      ReviewerDraftRevisionCommandDtoSchema.parse({
        draftId: "draft-a",
        generationId: "generation-a",
        expectedRevision: 1,
        text: "The team was exceptionally attentive.",
      }),
    ).toEqual({
      draftId: "draft-a",
      generationId: "generation-a",
      expectedRevision: 1,
      text: "The team was exceptionally attentive.",
    });

    const invocation = {
      operation: "record-reviewer-draft-revision",
      permit: "signed-draft-revision-permit",
      scope,
      text: "The team was exceptionally attentive.",
    };
    expect(RecordReviewerDraftRevisionInvocationDtoSchema.parse(invocation)).toEqual(
      invocation,
    );
    expect(GenerationFunctionInvocationDtoSchema.parse(invocation)).toEqual(
      invocation,
    );

    expect(
      RecordReviewerDraftRevisionResultDtoSchema.parse({
        operation: "record-reviewer-draft-revision",
        status: "recorded",
        revision: 2,
      }),
    ).toEqual({
      operation: "record-reviewer-draft-revision",
      status: "recorded",
      revision: 2,
    });
  });

  it("does not accept blank text, an unbounded revision or injected authority", () => {
    expect(
      ReviewerDraftRevisionCommandDtoSchema.safeParse({
        draftId: "draft-a",
        generationId: "generation-a",
        expectedRevision: 0,
        text: "   ",
        tenantId: "tenant-a",
      }).success,
    ).toBe(false);
  });
});
