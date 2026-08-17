import fs from "node:fs";
import { describe, expect, it } from "vitest";

import { handler } from "./main.js";

describe("US-01.3 Context production composition", () => {
  it("exports one lazy private Lambda handler with only operational credentials", () => {
    expect(handler).toBeTypeOf("function");
    const source = fs.readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    const environmentKeys = [
      ...source.matchAll(
        /(?:required\(|decodeKey\(|process\.env\[)["']([^"']+)["']/g,
      ),
    ].map((match) => match[1]);
    expect(new Set(environmentKeys)).toEqual(
      new Set([
        "DATABASE_URL",
        "CONTEXT_WORK_PRIVATE_KEY_B64",
        "GENERATION_WORK_PUBLIC_KEY_B64",
      ]),
    );
    expect(source).not.toContain("serve(");
  });
});
