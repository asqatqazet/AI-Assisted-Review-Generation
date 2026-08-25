import { describe, expect, it } from "vitest";

import { GeminiProvider } from "./gemini-provider.js";
import { ModelGatewayError } from "./model-gateway.js";

describe("Gemini ModelGateway adapter", () => {
  it("does not read an ambient credential when none was injected", async () => {
    const previousCredential = process.env["GEMINI_API_KEY"];
    process.env["GEMINI_API_KEY"] = "ambient-key-that-must-be-ignored";
    let providerWasCalled = false;
    try {
      const provider = new GeminiProvider({
        fetchFn: async () => {
          providerWasCalled = true;
          return new Response(
            JSON.stringify({
              candidates: [
                {
                  content: { parts: [{ text: "{}" }] },
                  finishReason: "STOP",
                },
              ],
            }),
            { status: 200 },
          );
        },
      });

      const error = await provider
        .generate({
          model: "gemini-test-model",
          messages: [{ role: "user", content: "Draft review" }],
          maxOutputTokens: 100,
          outputSchema: { name: "review", schema: { type: "object" } },
        })
        .catch((reason: unknown) => reason);

      expect(error).toBeInstanceOf(ModelGatewayError);
      expect(error).toMatchObject({ code: "auth" });
      expect(providerWasCalled).toBe(false);
    } finally {
      if (previousCredential === undefined) {
        delete process.env["GEMINI_API_KEY"];
      } else {
        process.env["GEMINI_API_KEY"] = previousCredential;
      }
    }
  });

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

  it("does not expose transport exception details", async () => {
    const provider = new GeminiProvider({
      apiKey: "injected-test-key",
      fetchFn: async () => {
        throw new Error("tenant-a secret-value internal-host");
      },
    });

    const error = await provider
      .generate({
        model: "gemini-test-model",
        messages: [{ role: "user", content: "Draft review" }],
        maxOutputTokens: 100,
        outputSchema: { name: "review", schema: { type: "object" } },
      })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ModelGatewayError);
    expect(error).toMatchObject({ code: "unavailable" });
    expect(String(error)).not.toContain("tenant-a");
    expect(String(error)).not.toContain("secret-value");
    expect(String(error)).not.toContain("internal-host");
  });

  it("normalizes a malformed provider envelope as invalid output", async () => {
    const provider = new GeminiProvider({
      apiKey: "injected-test-key",
      fetchFn: async () => new Response("not-json", { status: 200 }),
    });

    const error = await provider
      .generate({
        model: "gemini-test-model",
        messages: [{ role: "user", content: "Draft review" }],
        maxOutputTokens: 100,
        outputSchema: { name: "review", schema: { type: "object" } },
      })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ModelGatewayError);
    expect(error).toMatchObject({ code: "invalid-output" });
  });

  it("normalizes a blocked response as a content filter failure", async () => {
    const provider = new GeminiProvider({
      apiKey: "injected-test-key",
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            candidates: [],
            promptFeedback: { blockReason: "sensitive-provider-detail" },
          }),
          { status: 200 },
        ),
    });

    const error = await provider
      .generate({
        model: "gemini-test-model",
        messages: [{ role: "user", content: "Draft review" }],
        maxOutputTokens: 100,
        outputSchema: { name: "review", schema: { type: "object" } },
      })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ModelGatewayError);
    expect(error).toMatchObject({ code: "content-filter" });
    expect(String(error)).not.toContain("sensitive-provider-detail");
  });
});
