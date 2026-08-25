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
  "activation",
  "apikey",
  "assertion",
  "assertions",
  "authorization",
  "body",
  "browsercapability",
  "candidate",
  "candidatetext",
  "claim",
  "claims",
  "cookie",
  "credential",
  "credentialreference",
  "csrftoken",
  "customerassertion",
  "draft",
  "freetext",
  "invitationtoken",
  "permit",
  "prompt",
  "proposition",
  "providerresponse",
  "quotedtext",
  "rawdraft",
  "requestpayload",
  "responsebody",
  "setcookie",
  "snapshot",
  "sourcetext",
  "submittedtext",
  "terminalreceipt",
  "unsupportedoutput",
  "userinput",
  "customertext",
]);

const normalizedKey = (key: string): string =>
  key.toLowerCase().replaceAll(/[^a-z0-9]/g, "");

const mustRedact = (key: string): boolean => {
  const normalized = normalizedKey(key);
  return (
    REDACTED_KEYS.has(normalized) ||
    normalized.endsWith("secret") ||
    normalized.endsWith("permit") ||
    normalized.endsWith("receipt") ||
    normalized.endsWith("capability") ||
    normalized === "token" ||
    normalized.endsWith("tokenhash")
  );
};

const redactValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item));
  }
  if (value !== null && typeof value === "object") {
    return redactDraftText(value as Record<string, unknown>);
  }
  return value;
};

export function redactDraftText<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (mustRedact(key)) {
      result[key] = "[REDACTED]";
    } else {
      result[key] = redactValue(value);
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
