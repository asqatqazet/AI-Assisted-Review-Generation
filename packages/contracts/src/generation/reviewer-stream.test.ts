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

  it("reveals only the minimal Draft projection at terminal success", () => {
    const terminal = ReviewerGenerationEventDtoSchema.parse({
      type: "terminal",
      status: "completed",
      draft: {
        id: "draft-a",
        generationId: "generation-a",
        revision: 1,
        text: "The team was attentive.",
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
      },
    });
    expect(
      ReviewerGenerationEventDtoSchema.safeParse({
        ...terminal,
        generation: { tenantId: "tenant-a" },
      }).success,
    ).toBe(false);
  });

  it("uses stable public rejection codes without unsafe output", () => {
    expect(
      ReviewerGenerationEventDtoSchema.parse({
        type: "terminal",
        status: "rejected",
        code: "GROUNDING_REJECTED",
        retryable: false,
      }),
    ).toEqual({
      type: "terminal",
      status: "rejected",
      code: "GROUNDING_REJECTED",
      retryable: false,
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
