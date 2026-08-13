import {
  ModelGatewayError,
  type JsonObject,
  type ModelGateway,
  type ModelRequest,
  type ModelRun,
} from "./model-gateway.js";

export interface OpenAIProviderOptions {
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly fetchFn?: typeof fetch;
  readonly defaultTimeoutMs?: number;
}

export class OpenAIProvider implements ModelGateway {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #fetchFn: typeof fetch;
  readonly #defaultTimeoutMs: number;

  public constructor(options: OpenAIProviderOptions = {}) {
    this.#apiKey = options.apiKey ?? process.env["OPENAI_API_KEY"] ?? "";
    this.#baseUrl = options.baseUrl ?? "https://api.openai.com/v1";
    this.#fetchFn = options.fetchFn ?? globalThis.fetch;
    this.#defaultTimeoutMs = options.defaultTimeoutMs ?? 45_000;
  }

  public async generate(
    request: ModelRequest,
    signal?: AbortSignal,
  ): Promise<ModelRun> {
    if (signal && signal.aborted) {
      throw new ModelGatewayError(
        "cancellation",
        "Model generation was cancelled before it started.",
      );
    }

    const payload = {
      model: request.model,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      max_tokens: request.maxOutputTokens,
      temperature: request.temperature ?? 0.7,
      response_format: { type: "json_object" },
    };

    const timeoutSignal = AbortSignal.timeout(this.#defaultTimeoutMs);
    const activeSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

    let response: Response;
    try {
      response = await this.#fetchFn(`${this.#baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.#apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: activeSignal,
      });
    } catch (error) {
      if (activeSignal.aborted) {
        throw new ModelGatewayError(
          "cancellation",
          "Model generation was cancelled.",
        );
      }
      throw new ModelGatewayError(
        "unavailable",
        error instanceof Error ? error.message : "Network error contacting OpenAI.",
      );
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      if (response.status === 401 || response.status === 403) {
        throw new ModelGatewayError("auth", `OpenAI authentication error: ${errorText}`);
      }
      if (response.status === 429) {
        throw new ModelGatewayError("rate-limit", `OpenAI rate limit reached: ${errorText}`);
      }
      if (response.status === 400 && errorText.toLowerCase().includes("content")) {
        throw new ModelGatewayError("content-filter", `OpenAI content filter: ${errorText}`);
      }
      if (response.status >= 500) {
        throw new ModelGatewayError("unavailable", `OpenAI server error (${response.status}): ${errorText}`);
      }
      throw new ModelGatewayError("provider", `OpenAI error (${response.status}): ${errorText}`);
    }

    const rawJson = (await response.json()) as {
      id?: string;
      choices?: Array<{
        message?: { content?: string };
        finish_reason?: string;
      }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
      };
    };

    const rawContent = rawJson.choices?.[0]?.message?.content ?? "{}";
    let output: JsonObject;
    try {
      output = JSON.parse(rawContent) as JsonObject;
    } catch {
      throw new ModelGatewayError(
        "invalid-output",
        "Failed to parse structured JSON output from OpenAI response.",
      );
    }

    return {
      output,
      attempt: {
        provider: "openai",
        model: request.model,
        usage: {
          inputTokens: rawJson.usage?.prompt_tokens ?? 0,
          outputTokens: rawJson.usage?.completion_tokens ?? 0,
        },
        receipt: {
          requestId: rawJson.id ?? "unknown-id",
          finishReason: (rawJson.choices?.[0]?.finish_reason as "stop" | "length") ?? "stop",
        },
      },
    };
  }
}
