export interface ModelGatewayMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface ModelGatewayRequest {
  readonly model: string;
  readonly messages: readonly ModelGatewayMessage[];
  readonly maxOutputTokens: number;
  readonly outputSchema: {
    readonly name: string;
    readonly schema: Record<string, unknown>;
  };
}

export interface ModelGatewayUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface ModelGatewayReceipt {
  readonly requestId: string;
  readonly finishReason: "stop" | "length" | "content-filter" | "tool-use" | "unknown";
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface ModelGatewayAttempt {
  readonly provider: string;
  readonly model: string;
  readonly usage: ModelGatewayUsage;
  readonly receipt: ModelGatewayReceipt;
}

export interface ModelGatewayRun {
  readonly output: Readonly<Record<string, unknown>>;
  readonly attempt: ModelGatewayAttempt;
}

export interface ModelGatewayPort {
  generate(
    request: ModelGatewayRequest,
    signal?: AbortSignal,
  ): Promise<ModelGatewayRun>;
}
