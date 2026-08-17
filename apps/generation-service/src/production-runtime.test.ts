import type { GenerationWorkloadDto } from "@review/contracts/generation";
import { describe, expect, it } from "vitest";

import { handler } from "./main.js";
import { createAssessmentFakeGateway } from "./runtime.js";

describe("US-01.3 Generation production composition", () => {
  it("exports a Lambda handler instead of a development HTTP app", () => {
    expect(handler).toBeTypeOf("function");
  });

  it("creates deterministic grounded FakeProvider output from the supplied workload", async () => {
    const workload = {
      bindings: { generationId: "generation-a" },
      assertions: [
        {
          id: "assertion-a",
          semanticId: "fact-a",
          semanticKind: "experience-fact",
          polarity: "positive",
          proposition: "The team was attentive.",
        },
      ],
    } as GenerationWorkloadDto;
    const gateway = createAssessmentFakeGateway(workload, { delayMs: 0 });

    await expect(
      gateway.generate({
        model: "fake-v1",
        messages: [{ role: "user", content: "bound prompt" }],
        maxOutputTokens: 350,
        outputSchema: { name: "CandidateGeneration", schema: {} },
      }),
    ).resolves.toMatchObject({
      output: {
        claims: [
          {
            text: "The team was attentive.",
            assertionIds: ["assertion-a"],
          },
        ],
      },
      attempt: {
        provider: "fake",
        model: "fake-v1",
        receipt: { finishReason: "stop" },
      },
    });
  });
});
