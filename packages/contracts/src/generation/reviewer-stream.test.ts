import { describe, expect, it } from "vitest";

import {
  ReviewerGenerationCommandDtoSchema,
  ReviewerGenerationEventDtoSchema,
} from "./reviewer-stream.js";

describe("reviewer Generation stream contract", () => {
  it("accepts only the reviewer choices needed to start Generation", () => {
    expect(
      ReviewerGenerationCommandDtoSchema.parse({
        factOptionIds: ["fact-attentive"],
        reviewFormatId: "format-concise-v1",
      }),
    ).toEqual({
      factOptionIds: ["fact-attentive"],
      reviewFormatId: "format-concise-v1",
    });

    expect(
      ReviewerGenerationCommandDtoSchema.safeParse({
        factOptionIds: ["fact-attentive"],
        reviewFormatId: "format-concise-v1",
        tenantId: "tenant-a",
      }).success,
    ).toBe(false);
  });

  it("accepts a bounded reviewer-authored assertion without scope authority", () => {
    expect(
      ReviewerGenerationCommandDtoSchema.parse({
        factOptionIds: ["fact-attentive"],
        reviewFormatId: "format-concise-v1",
        customerAssertion: "  The reception was calm.  ",
      }),
    ).toEqual({
      factOptionIds: ["fact-attentive"],
      reviewFormatId: "format-concise-v1",
      customerAssertion: "The reception was calm.",
    });

    expect(
      ReviewerGenerationCommandDtoSchema.safeParse({
        factOptionIds: ["fact-attentive"],
        reviewFormatId: "format-concise-v1",
        customerAssertion: "x".repeat(5_001),
      }).success,
    ).toBe(false);
  });

  it("accepts a free-text Assertion as the sole non-rating grounding source", () => {
    expect(
      ReviewerGenerationCommandDtoSchema.parse({
        factOptionIds: [],
        reviewFormatId: "format-concise-v1",
        customerAssertion: "  The reception was calm.  ",
      }),
    ).toEqual({
      factOptionIds: [],
      reviewFormatId: "format-concise-v1",
      customerAssertion: "The reception was calm.",
    });

    expect(
      ReviewerGenerationCommandDtoSchema.safeParse({
        factOptionIds: [],
        reviewFormatId: "format-concise-v1",
      }).success,
    ).toBe(false);
  });

  it("represents Paraphrase as source text rather than selected Fact Options", () => {
    expect(
      ReviewerGenerationCommandDtoSchema.parse({
        sourceText: "The team was kind and the waiting area was quiet.",
        reviewFormatId: "format-concise-v1",
      }),
    ).toEqual({
      sourceText: "The team was kind and the waiting area was quiet.",
      reviewFormatId: "format-concise-v1",
    });

    expect(
      ReviewerGenerationCommandDtoSchema.safeParse({
        sourceText: "Too short",
        factOptionIds: ["fact-attentive"],
        reviewFormatId: "format-concise-v1",
      }).success,
    ).toBe(false);
  });

  it.each([
    {
      command: {
        action: "resample",
        sourceGenerationId: "generation-a",
      },
      action: "resample",
    },
    {
      command: {
        action: "reformat",
        sourceGenerationId: "generation-a",
        reviewFormatId: "format-detailed-v2",
      },
      action: "reformat",
    },
    {
      command: {
        action: "condense",
        sourceGenerationId: "generation-a",
        targetMaxChars: 180,
      },
      action: "condense",
    },
    {
      command: {
        action: "expand",
        sourceGenerationId: "generation-a",
        targetMinChars: 260,
      },
      action: "expand",
    },
    {
      command: {
        action: "revise-wording",
        sourceGenerationId: "generation-a",
        presentationInstruction: "Use warmer wording.",
      },
      action: "revise-wording",
    },
  ])("accepts the $action command with immutable Generation lineage", ({ command }) => {
    expect(ReviewerGenerationCommandDtoSchema.parse(command)).toEqual(command);
  });

  it("never accepts editable Draft text as grounding for a transformation", () => {
    expect(
      ReviewerGenerationCommandDtoSchema.safeParse({
        action: "resample",
        sourceGenerationId: "generation-a",
        draftText: "A typed claim that was never grounded.",
      }).success,
    ).toBe(false);
  });

  it("exposes progress without candidate or Draft text", () => {
    expect(
      ReviewerGenerationEventDtoSchema.parse({
        type: "progress",
        phase: "validating",
        elapsedSeconds: 12,
      }),
    ).toEqual({
      type: "progress",
      phase: "validating",
      elapsedSeconds: 12,
    });

    expect(
      ReviewerGenerationEventDtoSchema.safeParse({
        type: "progress",
        phase: "generating",
        elapsedSeconds: 4,
        text: "unvalidated candidate bytes",
      }).success,
    ).toBe(false);
  });

  it("keeps the editable Draft body separate from typed system annotations", () => {
    const disclosure =
      "Review generated with AI assistance on behalf of Apex Dental.";
    const terminal = ReviewerGenerationEventDtoSchema.parse({
      type: "terminal",
      status: "completed",
      draft: {
        id: "draft-a",
        generationId: "generation-a",
        revision: 1,
        text: "The team was attentive.",
        systemAnnotations: [
          {
            kind: "assisted-review-disclosure",
            text: disclosure,
            policyVersionId: "tenant-policy-r7",
          },
        ],
      },
    });

    expect(terminal).toEqual({
      type: "terminal",
      status: "completed",
      draft: {
        id: "draft-a",
        generationId: "generation-a",
        revision: 1,
        text: "The team was attentive.",
        systemAnnotations: [
          {
            kind: "assisted-review-disclosure",
            text: disclosure,
            policyVersionId: "tenant-policy-r7",
          },
        ],
      },
    });
    expect(
      ReviewerGenerationEventDtoSchema.safeParse({
        type: "terminal",
        status: "completed",
        draft: {
          id: "draft-a",
          generationId: "generation-a",
          revision: 1,
          text: `The team was attentive.\n\n${disclosure}`,
        },
      }).success,
    ).toBe(false);
    if (terminal.type !== "terminal" || terminal.status !== "completed") {
      throw new Error("Expected a completed reviewer terminal fixture");
    }
    expect(
      ReviewerGenerationEventDtoSchema.safeParse({
        ...terminal,
        generation: { tenantId: "tenant-a" },
      }).success,
    ).toBe(false);
    expect(
      ReviewerGenerationEventDtoSchema.safeParse({
        ...terminal,
        draft: {
          ...terminal.draft,
          providerOutput: { claims: [{ text: "private provider bytes" }] },
        },
      }).success,
    ).toBe(false);
  });

  it("uses stable public rejection codes without unsafe output", () => {
    expect(
      ReviewerGenerationEventDtoSchema.parse({
        type: "terminal",
        status: "rejected",
        code: "RATE_LIMITED",
        retryable: true,
        retryAfterSeconds: 73,
      }),
    ).toEqual({
      type: "terminal",
      status: "rejected",
      code: "RATE_LIMITED",
      retryable: true,
      retryAfterSeconds: 73,
    });

    expect(
      ReviewerGenerationEventDtoSchema.safeParse({
        type: "terminal",
        status: "rejected",
        code: "GROUNDING_REJECTED",
        retryable: false,
        unsupportedOutput: "unsafe candidate bytes",
      }).success,
    ).toBe(false);
  });
});
