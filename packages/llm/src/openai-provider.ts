import {
  ModelGatewayError,
  type JsonObject,
  type ModelGateway,
  type ModelRequest,
  type ModelRun,
} from "./model-gateway.js";

function retryAfterMs(response: Response): number | undefined {
  const seconds = Number(response.headers.get("Retry-After"));
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : undefined;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface OpenAIProviderOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly fetchFn?: typeof fetch;
  readonly defaultTimeoutMs?: number;
}

export class OpenAIProvider implements ModelGateway {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #fetchFn: typeof fetch;
  readonly #defaultTimeoutMs: number;

  public constructor(options: OpenAIProviderOptions) {
    this.#apiKey = options.apiKey;
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
    if (this.#apiKey === "") {
      throw new ModelGatewayError("auth", "OpenAI API credentials are unavailable.");
    }

    const payload = {
      model: request.model,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      max_completion_tokens: request.maxOutputTokens,
      ...(request.temperature === undefined
        ? {}
        : { temperature: request.temperature }),
      response_format: {
        type: "json_schema",
        json_schema: {
          name: request.outputSchema.name,
          strict: true,
          schema: request.outputSchema.schema,
        },
      },
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
    } catch {
      if (signal?.aborted === true) {
        throw new ModelGatewayError(
          "cancellation",
          "Model generation was cancelled.",
        );
      }
      if (timeoutSignal.aborted) {
        throw new ModelGatewayError("timeout", "OpenAI generation timed out.");
      }
      throw new ModelGatewayError(
        "unavailable",
        "OpenAI service could not be reached.",
      );
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      if (response.status === 401 || response.status === 403) {
        throw new ModelGatewayError("auth", "OpenAI authentication failed.");
      }
      if (response.status === 429) {
        const retryAfter = retryAfterMs(response);
        throw new ModelGatewayError("rate-limit", "OpenAI rate limit reached.", {
          ...(retryAfter === undefined ? {} : { retryAfterMs: retryAfter }),
        });
      }
      if (response.status === 400 && errorText.toLowerCase().includes("content")) {
        throw new ModelGatewayError(
          "content-filter",
          "OpenAI rejected the request under its content policy.",
        );
      }
      if (response.status >= 500) {
        throw new ModelGatewayError(
          "unavailable",
          `OpenAI service unavailable (${response.status}).`,
        );
      }
      throw new ModelGatewayError(
        "provider",
        `OpenAI request failed (${response.status}).`,
      );
    }

    let rawJson: {
      id?: string;
      choices?: Array<{
        message?: { content?: string | null; refusal?: string | null };
        finish_reason?: string;
      }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
      };
    };
    try {
      rawJson = (await response.json()) as typeof rawJson;
    } catch {
      throw new ModelGatewayError(
        "invalid-output",
        "OpenAI returned a malformed response envelope.",
      );
    }

    const choice = rawJson.choices?.[0];
    if (
      typeof choice?.message?.refusal === "string" &&
      choice.message.refusal.length > 0
    ) {
      throw new ModelGatewayError(
        "content-filter",
        "OpenAI refused to produce the requested structured output.",
      );
    }
    const rawContent = choice?.message?.content;
    if (typeof rawContent !== "string" || rawContent.length === 0) {
      throw new ModelGatewayError(
        "invalid-output",
        "OpenAI returned no structured output.",
      );
    }
    let output: unknown;
    try {
      output = JSON.parse(rawContent) as unknown;
    } catch {
      throw new ModelGatewayError(
        "invalid-output",
        "Failed to parse structured JSON output from OpenAI response.",
      );
    }
    if (!isJsonObject(output)) {
      throw new ModelGatewayError(
        "invalid-output",
        "OpenAI did not return a structured JSON object.",
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
          finishReason: (choice?.finish_reason as "stop" | "length") ?? "stop",
        },
      },
    };
  }
}
