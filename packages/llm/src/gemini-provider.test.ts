import { describe, expect, it } from "vitest";

import { GeminiProvider } from "./gemini-provider.js";

describe("Gemini ModelGateway adapter", () => {
  it("uses the current Interactions structured-output contract", async () => {
    let receivedUrl: string | URL | Request | undefined;
    let receivedInit: RequestInit | undefined;
    const provider = new GeminiProvider({
      apiKey: "gemini-test-key",
      fetchFn: async (url, init) => {
        receivedUrl = url;
        receivedInit = init;
        return new Response(
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
                      draft: "Attentive service.",
                      claims: [
                        {
                          id: "c1",
                          text: "Attentive service.",
                          assertionIds: ["a1"],
                        },
                      ],
                    }),
                  },
                ],
              },
            ],
            usage: {
              total_input_tokens: 41,
              total_output_tokens: 17,
              total_cached_tokens: 3,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    });

    await expect(
      provider.generate({
        model: "gemini-3.5-flash-lite",
        messages: [
          { role: "system", content: "Use only confirmed assertions." },
          { role: "user", content: "Assertion a1: Attentive service." },
        ],
        maxOutputTokens: 350,
        outputSchema: {
          name: "candidate_generation",
          schema: {
            type: "object",
            properties: {
              draft: { type: "string" },
              claims: { type: "array", items: { type: "object" } },
            },
            required: ["draft", "claims"],
            additionalProperties: false,
          },
        },
      }),
    ).resolves.toMatchObject({
      output: {
        draft: "Attentive service.",
      },
      attempt: {
        provider: "gemini",
        model: "gemini-3.5-flash-lite",
        usage: {
          inputTokens: 41,
          outputTokens: 17,
          cacheReadInputTokens: 3,
        },
        receipt: {
          requestId: "interaction-123",
          finishReason: "stop",
        },
      },
    });

    expect(receivedUrl).toBe(
      "https://generativelanguage.googleapis.com/v1beta/interactions",
    );
    expect(new Headers(receivedInit?.headers).get("x-goog-api-key")).toBe(
      "gemini-test-key",
    );
    expect(JSON.parse(String(receivedInit?.body))).toEqual({
      model: "gemini-3.5-flash-lite",
      system_instruction: "Use only confirmed assertions.",
      input: "Assertion a1: Attentive service.",
      response_format: {
        type: "text",
        mime_type: "application/json",
        schema: {
          type: "object",
          properties: {
            draft: { type: "string" },
            claims: { type: "array", items: { type: "object" } },
          },
          required: ["draft", "claims"],
          additionalProperties: false,
        },
      },
      generation_config: { max_output_tokens: 350 },
      store: false,
    });
  });
});
