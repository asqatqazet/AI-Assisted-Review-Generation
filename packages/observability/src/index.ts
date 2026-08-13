export interface GenerationMetric {
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

const REDACTED_KEYS = new Set([
  "draft",
  "freetext",
  "prompt",
  "rawdraft",
  "submittedtext",
  "userinput",
  "customertext",
]);

export function redactDraftText<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    if (REDACTED_KEYS.has(lowerKey)) {
      result[key] = "[REDACTED]";
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      result[key] = redactDraftText(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }

  return result;
}

export interface StructuredLogMessage {
  readonly level: "info" | "warn" | "error";
  readonly message: string;
  readonly requestId?: string;
  readonly [key: string]: unknown;
}

export function logStructured(logData: StructuredLogMessage): void {
  const redacted = redactDraftText(logData);
  const payload = {
    timestamp: new Date().toISOString(),
    ...redacted,
  };

  console.log(JSON.stringify(payload));
}

export function emitGenerationMetric(metric: GenerationMetric): void {
  // In AWS Lambda / CloudWatch, Embedded Metric Format (EMF) logs
  const emfPayload = {
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [
        {
          Namespace: "ReviewGenerationPlatform",
          Dimensions: [["service", "commandKind", "outcome"]],
          Metrics: [
            { Name: "LatencyMs", Unit: "Milliseconds" },
            { Name: "InputTokens", Unit: "Count" },
            { Name: "OutputTokens", Unit: "Count" },
            { Name: "CostMicros", Unit: "Count" },
          ],
        },
      ],
    },
    ...metric,
  };

  console.log(JSON.stringify(emfPayload));
}
