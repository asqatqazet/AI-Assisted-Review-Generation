export interface GenerationTelemetryEvent {
  readonly service: "generation-service";
  readonly tenantId: string;
  readonly locationId: string;
  readonly commandKind: string;
  readonly provider: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costMicros: number;
  readonly latencyMs: number;
  readonly outcome: "pass" | "stripped" | "rejected" | "failure";
  readonly fallbackUsed: boolean;
}

export interface TelemetryPort {
  emit(event: GenerationTelemetryEvent): void;
}
