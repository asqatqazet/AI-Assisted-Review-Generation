import fs from "node:fs";
import { describe, expect, it } from "vitest";

import { handler as fastHandler } from "./main.js";
import { handler as streamHandler } from "./stream-main.js";

describe("US-01.3 BFF production composition", () => {
  it("exports lazy buffered and response-streaming Lambda handlers", () => {
    expect(fastHandler).toBeTypeOf("function");
    expect(streamHandler).toBeTypeOf("function");

    const fastSource = fs.readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    const streamSource = fs.readFileSync(
      new URL("./stream-main.ts", import.meta.url),
      "utf8",
    );
    const runtimeSource = fs.readFileSync(
      new URL("./runtime.ts", import.meta.url),
      "utf8",
    );

    expect(fastSource).toContain("handle(");
    expect(streamSource).toContain("streamHandle(");
    expect(fastSource).not.toContain("serve(");
    expect(streamSource).not.toContain("serve(");
    expect(runtimeSource).not.toContain("@review/db");
  });

  it("allows only public-operational settings and qualified service aliases", () => {
    const source = fs.readFileSync(new URL("./runtime.ts", import.meta.url), "utf8");
    const environmentKeys = [
      ...source.matchAll(
        /(?:required\(|qualifiedAliasArn\(|process\.env\[)["']([^"']+)["']/g,
      ),
    ].map((match) => match[1]);

    expect(new Set(environmentKeys)).toEqual(
      new Set([
        "CONTEXT_FUNCTION_ALIAS_ARN",
        "GENERATION_FUNCTION_ALIAS_ARN",
        "REVIEW_CSRF_SECRET",
        "REVIEW_PUBLIC_ORIGIN",
      ]),
    );
  });
});
