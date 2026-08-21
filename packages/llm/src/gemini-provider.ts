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

/**
 * Google's generateContent response. The adapter previously described an
 * interaction/steps envelope that this API does not return, so nothing it
 * produced could be parsed.
 */
interface GeminiGenerateContentResponse {
  readonly candidates?:
    | readonly {
        readonly content?:
          | { readonly parts?: readonly { readonly text?: string | undefined }[] | undefined }
          | undefined;
        readonly finishReason?: string | undefined;
      }[]
    | undefined;
  readonly usageMetadata?:
    | {
        readonly promptTokenCount?: number | undefined;
        readonly candidatesTokenCount?: number | undefined;
        readonly cachedContentTokenCount?: number | undefined;
      }
    | undefined;
  readonly promptFeedback?:
    | { readonly blockReason?: string | undefined }
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
      ...(systemInstruction === undefined
        ? {}
        : { systemInstruction: { parts: [{ text: systemInstruction }] } }),
      contents: [{ role: "user", parts: [{ text: input }] }],
      generationConfig: {
        maxOutputTokens: request.maxOutputTokens,
        ...(request.temperature === undefined
          ? {}
          : { temperature: request.temperature }),
        // Structured output is a hard requirement: the grounding guard parses
        // the result, so prose would be rejected downstream anyway.
        responseMimeType: "application/json",
        responseSchema: request.outputSchema.schema,
      },
    };
    const timeoutSignal = AbortSignal.timeout(this.#defaultTimeoutMs);
    const activeSignal = signal
      ? AbortSignal.any([signal, timeoutSignal])
      : timeoutSignal;

    let response: Response;
    try {
      response = await this.#fetchFn(
        `${this.#baseUrl}/models/${encodeURIComponent(request.model)}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": this.#apiKey,
          },
          body: JSON.stringify(payload),
          signal: activeSignal,
        },
      );
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

    const completion = (await response.json()) as GeminiGenerateContentResponse;
    const candidate = completion.candidates?.[0];
    if (candidate === undefined) {
      throw new ModelGatewayError(
        "invalid-output",
        completion.promptFeedback?.blockReason === undefined
          ? "Gemini returned no candidate."
          : `Gemini refused the request (${completion.promptFeedback.blockReason}).`,
      );
    }
    const outputText = (candidate.content?.parts ?? [])
      .map((part) => part.text ?? "")
      .join("");

    let output: unknown;
    try {
      output = outputText === "" ? undefined : JSON.parse(outputText);
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
          inputTokens: completion.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: completion.usageMetadata?.candidatesTokenCount ?? 0,
          cacheReadInputTokens:
            completion.usageMetadata?.cachedContentTokenCount ?? 0,
        },
        receipt: {
          requestId:
            response.headers.get("x-request-id") ?? `gemini-${request.model}`,
          finishReason: candidate.finishReason === "STOP" ? "stop" : "unknown",
        },
      },
    };
  }
}
