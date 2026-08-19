import fs from "node:fs";
import { describe, expect, it } from "vitest";

import { handler } from "./main.js";

describe("US-01.3 Context production composition", () => {
  it("exports one lazy private Lambda handler with only operational credentials", () => {
    expect(handler).toBeTypeOf("function");
    const source = fs.readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    const environmentKeys = [
      ...source.matchAll(
        /(?:required\(|requiredParameter\(|process\.env\[)["']([^"']+)["']/g,
      ),
    ].map((match) => match[1]);
    expect(new Set(environmentKeys)).toEqual(
      new Set([
        "CONTEXT_DATABASE_URL_PARAMETER",
        "CONTEXT_WORK_PRIVATE_KEY_PARAMETER",
        "GENERATION_WORK_PUBLIC_KEY_PARAMETER",
      ]),
    );
    expect(source).toContain("GetParameterCommand");
    expect(source).toContain("WithDecryption: true");
    expect(source).not.toMatch(/required\(["'](?:DATABASE_URL|.*KEY_B64)["']/);
    expect(source).not.toContain("serve(");
  });

  it("composes Operator Access through the control-plane database entry point", () => {
    const source = fs.readFileSync(new URL("./runtime.ts", import.meta.url), "utf8");

    expect(source).toContain("createPostgresOperatorAccessStore");
    expect(source).toContain("operatorService");
    expect(source).toContain("resolveAccess");
  });

  it("composes the Console over the control plane only", () => {
    const source = fs.readFileSync(new URL("./runtime.ts", import.meta.url), "utf8");

    expect(source).toContain("createPostgresConsoleControlPlaneStore");
    expect(source).toContain("consoleService");
    // Generation history belongs to the execution plane; the Console must not
    // reach it through the Context role.
    expect(source).not.toContain("executionStore");
  });
});
