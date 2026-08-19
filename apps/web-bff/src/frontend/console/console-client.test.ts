import { describe, expect, it } from "vitest";

import { createHttpConsoleClient } from "./console-client.js";

describe("Console transport binds every POST to its payload", () => {
  it("declares the body hash on a command", async () => {
    const seen: { url: string; headers: Headers; body: string }[] = [];
    const client = createHttpConsoleClient(async (input, init) => {
      seen.push({
        url: String(input),
        headers: new Headers(init?.headers),
        body: String(init?.body ?? ""),
      });
      return new Response(JSON.stringify({ outcome: "accepted" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    await client.runCommand({
      command: { command: "delete-keyword", keywordId: "keyword-1" },
      scope: { tenantId: "tenant-a", locationId: null },
    });

    const request = seen[0]!;
    expect(request.url).toContain("tenantId=tenant-a");
    // Without this header CloudFront's signature will not match the origin's.
    expect(request.headers.get("x-amz-content-sha256")).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.parse(request.body)).toEqual({
      command: "delete-keyword",
      keywordId: "keyword-1",
    });
  });

  it("declares a hash on the bodyless sign-out too", async () => {
    const seen: Headers[] = [];
    const client = createHttpConsoleClient(async (_input, init) => {
      seen.push(new Headers(init?.headers));
      return new Response(null, { status: 204 });
    });

    await client.logout();

    expect(seen[0]?.get("x-amz-content-sha256")).toMatch(/^[a-f0-9]{64}$/);
  });
});
