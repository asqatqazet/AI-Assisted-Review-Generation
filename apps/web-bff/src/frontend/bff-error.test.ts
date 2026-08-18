import { describe, expect, it } from "vitest";

import { BffClientError, readBffClientError } from "./bff-error.js";

describe("BFF client errors", () => {
  it("retains the normalized safe error and request correlation", async () => {
    const error = await readBffClientError(
      new Response(
        JSON.stringify({
          code: "ENTRY_UNAVAILABLE",
          message: "This review link is unavailable.",
          retryable: false,
          requestId: "request-a",
        }),
        { status: 404, headers: { "content-type": "application/json" } },
      ),
    );

    expect(error).toBeInstanceOf(BffClientError);
    expect(error).toMatchObject({
      code: "ENTRY_UNAVAILABLE",
      message: "This review link is unavailable.",
      retryable: false,
      requestId: "request-a",
    });
  });

  it("does not trust an unrecognized upstream error body", async () => {
    const error = await readBffClientError(
      new Response("origin exploded", {
        status: 502,
        headers: { "x-amzn-requestid": "edge-request-a" },
      }),
    );

    expect(error).toMatchObject({
      code: "REQUEST_FAILED",
      message: "The request could not be completed.",
      retryable: true,
      requestId: "edge-request-a",
    });
  });
});
