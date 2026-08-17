import { describe, expect, it } from "vitest";

import { createHttpGenerationClient } from "./generation-client.js";

function streamResponse(chunks: readonly string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }),
    {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    },
  );
}

describe("HTTP reviewer Generation client", () => {
  it("posts reviewer choices and yields progress before one terminal Draft", async () => {
    const requests: { input: RequestInfo | URL; init?: RequestInit }[] = [];
    const client = createHttpGenerationClient(async (input, init) => {
      requests.push({ input, init });
      return streamResponse([
        'data: {"type":"accepted"}\n\n',
        ': heartbeat\n\n',
        'data: {"type":"progress","phase":"valid',
        'ating","elapsedSeconds":12}\n\n',
        'data: {"type":"terminal","status":"completed","draft":{"id":"draft-a","generationId":"generation-a","revision":1,"text":"The team was attentive."}}\n\n',
      ]);
    });

    const events = [];
    for await (const event of client.start(
      {
        reviewSessionHandle: "review-session-demo",
        idempotencyKey: "generation-request-a",
        factOptionIds: ["fact-attentive"],
        reviewFormatId: "format-concise-v1",
      },
      new AbortController().signal,
    )) {
      events.push(event);
    }

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      input: "/api/v1/review-sessions/review-session-demo/generations",
      init: {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          Accept: "text/event-stream",
          "Content-Type": "application/json",
          "Idempotency-Key": "generation-request-a",
        },
      },
    });
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      factOptionIds: ["fact-attentive"],
      reviewFormatId: "format-concise-v1",
    });
    expect(events).toEqual([
      { type: "accepted" },
      { type: "progress", phase: "validating", elapsedSeconds: 12 },
      {
        type: "terminal",
        status: "completed",
        draft: {
          id: "draft-a",
          generationId: "generation-a",
          revision: 1,
          text: "The team was attentive.",
        },
      },
    ]);
  });

  it("rejects a stream that attempts to expose candidate text as progress", async () => {
    const client = createHttpGenerationClient(async () =>
      streamResponse([
        'data: {"type":"progress","phase":"generating","elapsedSeconds":1,"text":"unsafe"}\n\n',
      ]),
    );

    await expect(async () => {
      for await (const _event of client.start(
        {
          reviewSessionHandle: "review-session-demo",
          idempotencyKey: "generation-request-a",
          factOptionIds: ["fact-attentive"],
          reviewFormatId: "format-concise-v1",
        },
        new AbortController().signal,
      )) {
        // Consume the whole response so schema failures reach the caller.
      }
    }).rejects.toThrow();
  });
});
