export type OutcomeDisposition = "accepted" | "edited" | "discarded";

export interface OutcomePayload {
  readonly generationId: string;
  readonly disposition: OutcomeDisposition;
  readonly originalDraft: string;
  readonly submittedText?: string | undefined;
}

export interface StoredOutcome {
  readonly generationId: string;
  readonly disposition: OutcomeDisposition;
  readonly originalDraft: string;
  readonly submittedText: string | null;
  readonly normalizedEditDistance: number | null;
  readonly capturedAt: string;
}

function stripDisclosureLine(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.toLowerCase().includes("ai-assisted"))
    .join("\n")
    .trim();
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );

  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]!;
      } else {
        dp[i]![j] =
          1 +
          Math.min(
            dp[i - 1]![j]!, // deletion
            dp[i]![j - 1]!, // insertion
            dp[i - 1]![j - 1]!, // substitution
          );
      }
    }
  }

  return dp[m]![n]!;
}

export function computeEditDistance(original: string, submitted: string): number {
  const cleanOriginal = stripDisclosureLine(original);
  const cleanSubmitted = stripDisclosureLine(submitted);

  if (cleanOriginal.length === 0 && cleanSubmitted.length === 0) {
    return 0;
  }
  const maxLen = Math.max(cleanOriginal.length, cleanSubmitted.length);
  if (maxLen === 0) {
    return 0;
  }

  const rawDistance = levenshteinDistance(cleanOriginal, cleanSubmitted);
  return Number((rawDistance / maxLen).toFixed(4));
}

export function processOutcome(payload: OutcomePayload): StoredOutcome {
  let editDistance: number | null = null;
  if (payload.disposition === "accepted") {
    editDistance = 0;
  } else if (payload.disposition === "edited" && payload.submittedText) {
    editDistance = computeEditDistance(payload.originalDraft, payload.submittedText);
  }

  return {
    generationId: payload.generationId,
    disposition: payload.disposition,
    originalDraft: payload.originalDraft,
    submittedText: payload.submittedText ?? null,
    normalizedEditDistance: editDistance,
    capturedAt: new Date().toISOString(),
  };
}
