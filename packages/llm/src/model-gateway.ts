export type JsonPrimitive = boolean | number | string | null;

export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export interface ModelMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface ModelRequest {
  readonly model: string;
  readonly messages: readonly ModelMessage[];
  readonly maxOutputTokens: number;
  readonly temperature?: number;
  readonly outputSchema: {
    readonly name: string;
    readonly schema: JsonObject;
  };
}

export interface ModelUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadInputTokens?: number;
  readonly cacheWriteInputTokens?: number;
}

export interface ProviderReceipt {
  readonly requestId: string;
  readonly finishReason:
    | "stop"
    | "length"
    | "content-filter"
    | "tool-use"
    | "unknown";
  readonly metadata?: JsonObject;
}

export interface ModelAttempt {
  readonly provider: string;
  readonly model: string;
  readonly usage: ModelUsage;
  readonly receipt: ProviderReceipt;
}

export interface ModelRun {
  readonly output: JsonObject;
  readonly attempt: ModelAttempt;
}

export interface ModelGateway {
  generate(request: ModelRequest, signal?: AbortSignal): Promise<ModelRun>;
}

export type ModelFailureCode =
  | "timeout"
  | "rate-limit"
  | "auth"
  | "content-filter"
  | "provider"
  | "unavailable"
  | "cancellation"
  | "invalid-output";

export class ModelGatewayError extends Error {
  public constructor(
    public readonly code: ModelFailureCode,
    message: string,
  ) {
    super(message);
    this.name = "ModelGatewayError";
  }
}
