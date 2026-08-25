import { describe, expect, it, vi } from "vitest";

import { createHttpReviewProgressClient } from "./review-progress-client.js";

describe("US-02.3 Review Session progress browser adapter", () => {
  it("saves only resumable input under the current server epoch", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "saved",
          progress: {
            epoch: 3,
            phase: "format",
            selectedFactOptionIds: ["fact-a"],
            customerAssertion: "",
            sourceText: "",
            selectedReviewFormatId: null,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const client = createHttpReviewProgressClient(fetchFn);

    await expect(
      client.save({
        reviewSessionHandle: "review-session-a",
        expectedEpoch: 2,
        progress: {
          phase: "format",
          selectedFactOptionIds: ["fact-a"],
          customerAssertion: "",
          sourceText: "",
          selectedReviewFormatId: null,
        },
      }),
    ).resolves.toMatchObject({ status: "saved", progress: { epoch: 3 } });

    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, request] = fetchFn.mock.calls[0]!;
    expect(url).toBe("/api/v1/review-sessions/review-session-a/progress");
    expect(request).toMatchObject({
      method: "PUT",
      credentials: "same-origin",
      cache: "no-store",
    });
    expect(JSON.parse(String(request?.body))).toEqual({
      expectedEpoch: 2,
      progress: {
        phase: "format",
        selectedFactOptionIds: ["fact-a"],
        customerAssertion: "",
        sourceText: "",
        selectedReviewFormatId: null,
      },
    });
    expect(new Headers(request?.headers).get("x-amz-content-sha256")).toMatch(
      /^[a-f0-9]{64}$/,
    );
  });
});
