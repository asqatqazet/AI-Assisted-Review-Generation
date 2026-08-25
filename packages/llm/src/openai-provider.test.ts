import { describe, expect, it } from "vitest";

import { ModelGatewayError } from "./model-gateway.js";
import { OpenAIProvider } from "./openai-provider.js";

describe("OpenAI ModelGateway adapter", () => {
  it("fails closed before provider I/O when its injected credential is empty", async () => {
    let providerWasCalled = false;
    const provider = new OpenAIProvider({
      apiKey: "",
      fetchFn: async () => {
        providerWasCalled = true;
        return new Response(
          JSON.stringify({
            id: "must-not-be-observed",
            choices: [{ message: { content: "{}" }, finish_reason: "stop" }],
          }),
          { status: 200 },
        );
      },
    });

    const error = await provider
      .generate({
        model: "gpt-4.1-mini",
        messages: [{ role: "user", content: "Draft review" }],
        maxOutputTokens: 100,
        outputSchema: { name: "review", schema: { type: "object" } },
      })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ModelGatewayError);
    expect(error).toMatchObject({ code: "auth" });
    expect(providerWasCalled).toBe(false);
  });

  it("normalizes a provider 429 without leaking its response body", async () => {
    const provider = new OpenAIProvider({
      apiKey: "injected-test-key",
      fetchFn: async () =>
        new Response("tenant-a and sk-sensitive-value", {
          status: 429,
          headers: { "Retry-After": "2" },
        }),
    });

    const error = await provider
      .generate({
        model: "gpt-4.1-mini",
        messages: [{ role: "user", content: "Draft review" }],
        maxOutputTokens: 100,
        outputSchema: { name: "review", schema: { type: "object" } },
      })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ModelGatewayError);
    expect(error).toMatchObject({ code: "rate-limit", retryAfterMs: 2_000 });
    expect(String(error)).not.toContain("tenant-a");
    expect(String(error)).not.toContain("sk-sensitive-value");
  });

  it("distinguishes its bounded timeout from caller cancellation", async () => {
    const provider = new OpenAIProvider({
      apiKey: "injected-test-key",
      defaultTimeoutMs: 1,
      fetchFn: async (_url, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    });

    const error = await provider
      .generate({
        model: "gpt-4.1-mini",
        messages: [{ role: "user", content: "Draft review" }],
        maxOutputTokens: 100,
        outputSchema: { name: "review", schema: { type: "object" } },
      })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ModelGatewayError);
    expect(error).toMatchObject({ code: "timeout" });
  });

  it("sends the caller's schema as strict Structured Outputs", async () => {
    let receivedInit: RequestInit | undefined;
    const provider = new OpenAIProvider({
      apiKey: "injected-test-key",
      fetchFn: async (_url, init) => {
        receivedInit = init;
        return new Response(
          JSON.stringify({
            id: "chatcmpl-structured",
            choices: [{ message: { content: "{}" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 10, completion_tokens: 2 },
          }),
          { status: 200 },
        );
      },
    });
    const schema = {
      type: "object",
      properties: { claims: { type: "array" } },
      required: ["claims"],
      additionalProperties: false,
    } as const;

    await provider.generate({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: "Draft review" }],
      maxOutputTokens: 123,
      outputSchema: { name: "candidate_generation", schema },
    });

    expect(JSON.parse(String(receivedInit?.body))).toMatchObject({
      max_completion_tokens: 123,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "candidate_generation",
          strict: true,
          schema,
        },
      },
    });
    expect(JSON.parse(String(receivedInit?.body))).not.toHaveProperty("max_tokens");
  });

  it("does not expose transport exception details", async () => {
    const provider = new OpenAIProvider({
      apiKey: "injected-test-key",
      fetchFn: async () => {
        throw new Error("tenant-a sk-sensitive-value internal-host");
      },
    });

    const error = await provider
      .generate({
        model: "gpt-4.1-mini",
        messages: [{ role: "user", content: "Draft review" }],
        maxOutputTokens: 100,
        outputSchema: { name: "review", schema: { type: "object" } },
      })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ModelGatewayError);
    expect(error).toMatchObject({ code: "unavailable" });
    expect(String(error)).not.toContain("tenant-a");
    expect(String(error)).not.toContain("sk-sensitive-value");
    expect(String(error)).not.toContain("internal-host");
  });

  it("normalizes a malformed provider envelope as invalid output", async () => {
    const provider = new OpenAIProvider({
      apiKey: "injected-test-key",
      fetchFn: async () => new Response("not-json", { status: 200 }),
    });

    const error = await provider
      .generate({
        model: "gpt-4.1-mini",
        messages: [{ role: "user", content: "Draft review" }],
        maxOutputTokens: 100,
        outputSchema: { name: "review", schema: { type: "object" } },
      })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ModelGatewayError);
    expect(error).toMatchObject({ code: "invalid-output" });
  });

  it("rejects structured output that is not a JSON object", async () => {
    const provider = new OpenAIProvider({
      apiKey: "injected-test-key",
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            id: "chatcmpl-array",
            choices: [{ message: { content: "[]" }, finish_reason: "stop" }],
          }),
          { status: 200 },
        ),
    });

    const error = await provider
      .generate({
        model: "gpt-4.1-mini",
        messages: [{ role: "user", content: "Draft review" }],
        maxOutputTokens: 100,
        outputSchema: { name: "review", schema: { type: "object" } },
      })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ModelGatewayError);
    expect(error).toMatchObject({ code: "invalid-output" });
  });

  it("normalizes a structured-output refusal as a content filter failure", async () => {
    const provider = new OpenAIProvider({
      apiKey: "injected-test-key",
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            id: "chatcmpl-refusal",
            choices: [
              {
                message: { refusal: "sensitive provider explanation" },
                finish_reason: "stop",
              },
            ],
          }),
          { status: 200 },
        ),
    });

    const error = await provider
      .generate({
        model: "gpt-4.1-mini",
        messages: [{ role: "user", content: "Draft review" }],
        maxOutputTokens: 100,
        outputSchema: { name: "review", schema: { type: "object" } },
      })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ModelGatewayError);
    expect(error).toMatchObject({ code: "content-filter" });
    expect(String(error)).not.toContain("sensitive provider explanation");
  });
});
