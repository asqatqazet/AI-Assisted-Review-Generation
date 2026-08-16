import { describe, expect, it } from "vitest";

import { FakeModelGateway } from "./fake-model-gateway.js";
import { GeminiProvider } from "./gemini-provider.js";
import {
  type ModelGateway,
  type ModelGatewayError,
  type ModelRequest,
  type ModelRun,
} from "./model-gateway.js";
import { OpenAIProvider } from "./openai-provider.js";

const sampleRequest: ModelRequest = {
  model: "test-model",
  messages: [{ role: "user", content: "Draft review" }],
  maxOutputTokens: 200,
  outputSchema: {
    name: "review",
    schema: {
      type: "object",
      properties: {
        draft: { type: "string" },
      },
      required: ["draft"],
    },
  },
};

const sampleSuccessRun: ModelRun = {
  output: { draft: "Punctual and gentle hygienist." },
  attempt: {
    provider: "test-provider",
    model: "test-model",
    usage: { inputTokens: 50, outputTokens: 20 },
    receipt: { requestId: "req-contract-1", finishReason: "stop" },
  },
};

describe("TS-13 Model Gateway Contract Suite", () => {
  const providers: { name: string; create: () => ModelGateway }[] = [
    {
      name: "FakeModelGateway",
      create: () =>
        new FakeModelGateway([
          {
            outcome: "success",
            run: sampleSuccessRun,
          },
        ]),
    },
    {
      name: "OpenAIProvider (mocked transport)",
      create: () =>
        new OpenAIProvider({
          apiKey: "test-key",
          fetchFn: async () =>
            new Response(
              JSON.stringify({
                id: "chatcmpl-123",
                choices: [
                  {
                    message: {
                      content: JSON.stringify({ draft: "Punctual and gentle hygienist." }),
                    },
                    finish_reason: "stop",
                  },
                ],
                usage: { prompt_tokens: 50, completion_tokens: 20 },
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
        }),
    },
    {
      name: "GeminiProvider (mocked transport)",
      create: () =>
        new GeminiProvider({
          apiKey: "test-key",
          fetchFn: async () =>
            new Response(
              JSON.stringify({
                id: "interaction-123",
                status: "completed",
                steps: [
                  {
                    type: "model_output",
                    content: [
                      {
                        type: "text",
                        text: JSON.stringify({
                          draft: "Punctual and gentle hygienist.",
                        }),
                      },
                    ],
                  },
                ],
                usage: {
                  total_input_tokens: 50,
                  total_output_tokens: 20,
                },
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
        }),
    },
  ];

  for (const { name, create } of providers) {
    describe(`Contract for ${name}`, () => {
      it("returns structured output complying with requested schema", async () => {
        const gateway = create();
        const run = await gateway.generate(sampleRequest);

        expect(run).toBeDefined();
        expect(run.output).toMatchObject({ draft: "Punctual and gentle hygienist." });
        expect(run.attempt.usage.inputTokens).toBeGreaterThan(0);
        expect(run.attempt.usage.outputTokens).toBeGreaterThan(0);
      });

      it("honours pre-aborted signal by rejecting with cancellation error", async () => {
        const gateway = create();
        const controller = new AbortController();
        controller.abort();

        await expect(gateway.generate(sampleRequest, controller.signal)).rejects.toThrowError(
          expect.objectContaining<Partial<ModelGatewayError>>({
            code: "cancellation",
          }),
        );
      });
    });
  }
});
