import { describe, expect, it } from "vitest";

import { GeminiProvider } from "./gemini-provider.js";

describe("Gemini ModelGateway adapter", () => {
  it("calls generateContent with Gemini's own request shape", async () => {
    let receivedUrl: string | URL | Request | undefined;
    let receivedInit: RequestInit | undefined;
    const provider = new GeminiProvider({
      apiKey: "gemini-test-key",
      fetchFn: async (url, init) => {
        receivedUrl = url;
        receivedInit = init;
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
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
                finishReason: "STOP",
              },
            ],
            usageMetadata: {
              promptTokenCount: 41,
              candidatesTokenCount: 17,
              cachedContentTokenCount: 3,
            },
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "x-request-id": "gemini-request-123",
            },
          },
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
          requestId: "gemini-request-123",
          finishReason: "stop",
        },
      },
    });

    // The model is part of the path; there is no /interactions resource.
    expect(receivedUrl).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent",
    );
    expect(new Headers(receivedInit?.headers).get("x-goog-api-key")).toBe(
      "gemini-test-key",
    );
    expect(JSON.parse(String(receivedInit?.body))).toEqual({
      systemInstruction: {
        parts: [{ text: "Use only confirmed assertions." }],
      },
      contents: [
        { role: "user", parts: [{ text: "Assertion a1: Attentive service." }] },
      ],
      generationConfig: {
        maxOutputTokens: 350,
        responseMimeType: "application/json",
        responseSchema: {
          type: "object",
          properties: {
            draft: { type: "string" },
            claims: { type: "array", items: { type: "object" } },
          },
          required: ["draft", "claims"],
          additionalProperties: false,
        },
      },
    });
  });
});
