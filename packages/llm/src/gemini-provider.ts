import {
  ModelGatewayError,
  type JsonObject,
  type ModelGateway,
  type ModelRequest,
  type ModelRun,
} from "./model-gateway.js";

export interface GeminiProviderOptions {
  readonly apiKey?: string | undefined;
  readonly baseUrl?: string | undefined;
  readonly fetchFn?: typeof fetch | undefined;
  readonly defaultTimeoutMs?: number | undefined;
}

interface GeminiInteraction {
  readonly id?: string | undefined;
  readonly status?: string | undefined;
  readonly steps?:
    | readonly {
        readonly type?: string | undefined;
        readonly content?:
          | readonly {
              readonly type?: string | undefined;
              readonly text?: string | undefined;
            }[]
          | undefined;
      }[]
    | undefined;
  readonly usage?:
    | {
        readonly total_input_tokens?: number | undefined;
        readonly total_output_tokens?: number | undefined;
        readonly total_cached_tokens?: number | undefined;
      }
    | undefined;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mapInput(request: ModelRequest): {
  readonly systemInstruction: string | undefined;
  readonly input: string;
} {
  const systemInstruction = request.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const conversational = request.messages.filter(
    (message) => message.role !== "system",
  );
  const input =
    conversational.length === 1 && conversational[0]?.role === "user"
      ? conversational[0].content
      : conversational
          .map((message) => `${message.role}: ${message.content}`)
          .join("\n\n");

  return {
    systemInstruction: systemInstruction === "" ? undefined : systemInstruction,
    input,
  };
}

function retryAfterMs(response: Response): number | undefined {
  const seconds = Number(response.headers.get("Retry-After"));
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : undefined;
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

export class GeminiProvider implements ModelGateway {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #fetchFn: typeof fetch;
  readonly #defaultTimeoutMs: number;

  public constructor(options: GeminiProviderOptions = {}) {
    this.#apiKey = options.apiKey ?? process.env["GEMINI_API_KEY"] ?? "";
    this.#baseUrl =
      options.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta";
    this.#fetchFn = options.fetchFn ?? globalThis.fetch;
    this.#defaultTimeoutMs = options.defaultTimeoutMs ?? 45_000;
  }

  public async generate(
    request: ModelRequest,
    signal?: AbortSignal,
  ): Promise<ModelRun> {
    if (isAborted(signal)) {
      throw new ModelGatewayError(
        "cancellation",
        "Model generation was cancelled before it started.",
      );
    }
    if (this.#apiKey === "") {
      throw new ModelGatewayError("auth", "Gemini API credentials are unavailable.");
    }

    const { systemInstruction, input } = mapInput(request);
    const payload = {
      model: request.model,
      ...(systemInstruction === undefined
        ? {}
        : { system_instruction: systemInstruction }),
      input,
      response_format: {
        type: "text",
        mime_type: "application/json",
        schema: request.outputSchema.schema,
      },
      generation_config: {
        max_output_tokens: request.maxOutputTokens,
        ...(request.temperature === undefined
          ? {}
          : { temperature: request.temperature }),
      },
      store: false,
    };
    const timeoutSignal = AbortSignal.timeout(this.#defaultTimeoutMs);
    const activeSignal = signal
      ? AbortSignal.any([signal, timeoutSignal])
      : timeoutSignal;

    let response: Response;
    try {
      response = await this.#fetchFn(`${this.#baseUrl}/interactions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.#apiKey,
        },
        body: JSON.stringify(payload),
        signal: activeSignal,
      });
    } catch (error) {
      if (isAborted(signal)) {
        throw new ModelGatewayError("cancellation", "Model generation was cancelled.");
      }
      if (timeoutSignal.aborted) {
        throw new ModelGatewayError("timeout", "Gemini generation timed out.");
      }
      throw new ModelGatewayError(
        "unavailable",
        error instanceof Error ? error.message : "Network error contacting Gemini.",
      );
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new ModelGatewayError("auth", "Gemini authentication failed.");
      }
      if (response.status === 429) {
        const retryAfter = retryAfterMs(response);
        throw new ModelGatewayError("rate-limit", "Gemini rate limit reached.", {
          ...(retryAfter === undefined ? {} : { retryAfterMs: retryAfter }),
        });
      }
      if (response.status >= 500) {
        throw new ModelGatewayError(
          "unavailable",
          `Gemini service unavailable (${response.status}).`,
        );
      }
      throw new ModelGatewayError(
        "provider",
        `Gemini request failed (${response.status}).`,
      );
    }

    const interaction = (await response.json()) as GeminiInteraction;
    const outputText = interaction.steps
      ?.filter((step) => step.type === "model_output")
      .flatMap((step) => step.content ?? [])
      .find((content) => content.type === "text")?.text;

    let output: unknown;
    try {
      output = outputText === undefined ? undefined : JSON.parse(outputText);
    } catch {
      output = undefined;
    }
    if (!isJsonObject(output)) {
      throw new ModelGatewayError(
        "invalid-output",
        "Gemini did not return a structured JSON object.",
      );
    }

    return {
      output,
      attempt: {
        provider: "gemini",
        model: request.model,
        usage: {
          inputTokens: interaction.usage?.total_input_tokens ?? 0,
          outputTokens: interaction.usage?.total_output_tokens ?? 0,
          cacheReadInputTokens: interaction.usage?.total_cached_tokens ?? 0,
        },
        receipt: {
          requestId: interaction.id ?? "unknown-id",
          finishReason:
            interaction.status === "completed" ? "stop" : "unknown",
        },
      },
    };
  }
}
