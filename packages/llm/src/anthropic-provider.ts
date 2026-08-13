import {
  ModelGatewayError,
  type JsonObject,
  type ModelGateway,
  type ModelRequest,
  type ModelRun,
} from "./model-gateway.js";

export interface AnthropicProviderOptions {
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly fetchFn?: typeof fetch;
  readonly defaultTimeoutMs?: number;
}

export class AnthropicProvider implements ModelGateway {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #fetchFn: typeof fetch;
  readonly #defaultTimeoutMs: number;

  public constructor(options: AnthropicProviderOptions = {}) {
    this.#apiKey = options.apiKey ?? process.env["ANTHROPIC_API_KEY"] ?? "";
    this.#baseUrl = options.baseUrl ?? "https://api.anthropic.com/v1";
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

    const systemMessage = request.messages.find((m) => m.role === "system")?.content;
    const nonSystemMessages = request.messages.filter((m) => m.role !== "system");

    const payload = {
      model: request.model,
      system: systemMessage,
      messages: nonSystemMessages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      max_tokens: request.maxOutputTokens,
      temperature: request.temperature ?? 0.7,
    };

    const timeoutSignal = AbortSignal.timeout(this.#defaultTimeoutMs);
    const activeSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

    let response: Response;
    try {
      response = await this.#fetchFn(`${this.#baseUrl}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.#apiKey,
          "anthropic-version": "2023-06-01",
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
        error instanceof Error ? error.message : "Network error contacting Anthropic.",
      );
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      if (response.status === 401 || response.status === 403) {
        throw new ModelGatewayError("auth", `Anthropic authentication error: ${errorText}`);
      }
      if (response.status === 429) {
        throw new ModelGatewayError("rate-limit", `Anthropic rate limit reached: ${errorText}`);
      }
      if (response.status >= 500) {
        throw new ModelGatewayError("unavailable", `Anthropic server error (${response.status}): ${errorText}`);
      }
      throw new ModelGatewayError("provider", `Anthropic error (${response.status}): ${errorText}`);
    }

    const rawJson = (await response.json()) as {
      id?: string;
      content?: Array<{
        type?: string;
        text?: string;
      }>;
      stop_reason?: string;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
      };
    };

    const textContent =
      rawJson.content?.find((c) => c.type === "text")?.text ?? "{}";

    let output: JsonObject;
    try {
      output = JSON.parse(textContent) as JsonObject;
    } catch {
      throw new ModelGatewayError(
        "invalid-output",
        "Failed to parse structured JSON output from Anthropic response.",
      );
    }

    return {
      output,
      attempt: {
        provider: "anthropic",
        model: request.model,
        usage: {
          inputTokens: rawJson.usage?.input_tokens ?? 0,
          outputTokens: rawJson.usage?.output_tokens ?? 0,
        },
        receipt: {
          requestId: rawJson.id ?? "unknown-id",
          finishReason: (rawJson.stop_reason as "stop" | "length") ?? "stop",
        },
      },
    };
  }
}
