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

export function emitGenerationMetric(metric: GenerationMetric): void {
  // In AWS Lambda, CloudWatch Embedded Metric Format (EMF) logs
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

  if (typeof process !== "undefined" && process.env?.["NODE_ENV"] !== "test") {
    console.log(JSON.stringify(emfPayload));
  }
}
