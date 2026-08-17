import {
  ReviewerGenerationCommandDtoSchema,
  ReviewerGenerationEventDtoSchema,
  type ReviewerGenerationEventDto,
} from "@review/contracts/generation";

export interface StartReviewerGenerationInput {
  readonly reviewSessionHandle: string;
  readonly idempotencyKey: string;
  readonly factOptionIds: readonly string[];
  readonly reviewFormatId: string;
}

export interface GenerationClient {
  start(
    input: StartReviewerGenerationInput,
    signal: AbortSignal,
  ): AsyncIterable<ReviewerGenerationEventDto>;
}

export class GenerationTransportError extends Error {
  readonly code: "EDGE_THROTTLED" | "GENERATION_UNAVAILABLE";
  readonly retryable: boolean;

  constructor(
    code: "EDGE_THROTTLED" | "GENERATION_UNAVAILABLE",
    retryable: boolean,
  ) {
    super(code);
    this.name = "GenerationTransportError";
    this.code = code;
    this.retryable = retryable;
  }
}

const encoder = new TextEncoder();

async function sha256Hex(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    encoder.encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function dataPayload(eventBlock: string): string | null {
  const data = eventBlock
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());
  return data.length === 0 ? null : data.join("\n");
}

async function* parseEventStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<ReviewerGenerationEventDto> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      buffered += decoder.decode(value, { stream: !done }).replaceAll("\r\n", "\n");

      let separator = buffered.indexOf("\n\n");
      while (separator >= 0) {
        const block = buffered.slice(0, separator);
        buffered = buffered.slice(separator + 2);
        const payload = dataPayload(block);
        if (payload !== null) {
          const event = ReviewerGenerationEventDtoSchema.parse(
            JSON.parse(payload) as unknown,
          );
          yield event;
          if (event.type === "terminal") {
            return;
          }
        }
        separator = buffered.indexOf("\n\n");
      }

      if (done) {
        throw new Error("GENERATION_STREAM_INCOMPLETE");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export function createHttpGenerationClient(
  fetchFn: typeof fetch = globalThis.fetch,
): GenerationClient {
  return {
    async *start(input, signal) {
      if (input.idempotencyKey.length < 1 || input.idempotencyKey.length > 200) {
        throw new Error("INVALID_IDEMPOTENCY_KEY");
      }
      const command = ReviewerGenerationCommandDtoSchema.parse({
        factOptionIds: input.factOptionIds,
        reviewFormatId: input.reviewFormatId,
      });
      const serializedCommand = JSON.stringify(command);
      const response = await fetchFn(
        `/api/v1/review-sessions/${encodeURIComponent(input.reviewSessionHandle)}/generations`,
        {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: {
            Accept: "text/event-stream",
            "Content-Type": "application/json",
            "Idempotency-Key": input.idempotencyKey,
            "x-amz-content-sha256": await sha256Hex(serializedCommand),
          },
          body: serializedCommand,
          signal,
        },
      );

      if (response.status === 429) {
        throw new GenerationTransportError("EDGE_THROTTLED", true);
      }
      if (!response.ok || response.body === null) {
        throw new GenerationTransportError("GENERATION_UNAVAILABLE", true);
      }

      yield* parseEventStream(response.body);
    },
  };
}
