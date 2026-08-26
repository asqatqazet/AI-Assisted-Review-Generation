import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const root = new URL("../..", import.meta.url);
const gatePath = new URL(
  "../../scripts/detect-legacy-context-rollback-dependency.sh",
  import.meta.url,
);
const workflow = readFileSync(
  new URL("../../.github/workflows/deploy-student.yml", import.meta.url),
  "utf8",
);

function runGate(
  mode: "legacy" | "split",
  acknowledgeCutover: boolean,
): { readonly status: number | null; readonly output: string } {
  const temporary = mkdtempSync(join(tmpdir(), "review-legacy-gate-"));
  const bin = join(temporary, "bin");
  mkdirSync(bin);
  const aws = join(bin, "aws");
  writeFileSync(
    aws,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "$*" != lambda\\ get-function-configuration* ]]; then
  printf 'unexpected aws invocation: %s\\n' "$*" >&2
  exit 1
fi
if [[ "$MOCK_BFF_MODE" = legacy ]]; then
  printf '%s\\n' '{"Environment":{"Variables":{"CONTEXT_FUNCTION_ALIAS_ARN":"arn:aws:lambda:eu-central-1:550684042331:function:review-context-service-student:live"}}}'
else
  printf '%s\\n' '{"Environment":{"Variables":{"CONTEXT_REVIEWER_FUNCTION_ALIAS_ARN":"arn:aws:lambda:eu-central-1:550684042331:function:review-context-reviewer-student:17","CONTEXT_CONSOLE_FUNCTION_ALIAS_ARN":"arn:aws:lambda:eu-central-1:550684042331:function:review-context-console-student:12"}}}'
fi
`,
    "utf8",
  );
  chmodSync(aws, 0o700);
  const outputPath = join(temporary, "github-output");
  const result = spawnSync("bash", [gatePath.pathname], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      ACKNOWLEDGE_DATABASE_CUTOVER: String(acknowledgeCutover),
      GITHUB_OUTPUT: outputPath,
      MOCK_BFF_MODE: mode,
      PATH: `${bin}${delimiter}${process.env["PATH"] ?? ""}`,
    },
  });
  return {
    status: result.status,
    output: result.status === 0 ? readFileSync(outputPath, "utf8") : result.stderr,
  };
}

describe("legacy Context rollback dependency gate", () => {
  it("requires the probe when the live BFF still invokes combined Context", () => {
    expect(runGate("legacy", false)).toEqual({
      status: 0,
      output: "required=true\ncutover=false\n",
    });
  });

  it("permits an explicit one-time database cutover without claiming rollback", () => {
    expect(runGate("legacy", true)).toEqual({
      status: 0,
      output: "required=false\ncutover=true\n",
    });
  });

  it("does not probe dormant combined Context after live BFF is split", () => {
    expect(runGate("split", false)).toEqual({
      status: 0,
      output: "required=false\ncutover=false\n",
    });
  });

  it("wires the explicit cutover decision into the release manifest", () => {
    expect(workflow).toContain("acknowledge_database_cutover");
    expect(workflow).toContain(
      "scripts/detect-legacy-context-rollback-dependency.sh",
    );
    expect(workflow).toContain("steps.legacy_dependency.outputs.required");
    expect(workflow).toContain("steps.legacy_dependency.outputs.cutover");
    expect(workflow).toContain("dbCompatibility:{phase:$dbCompatibilityPhase");
  });

  it("restores a previously safe Generation when the probe fails before migrations", () => {
    expect(workflow).toMatch(
      /Restore Generation after a pre-migration failure[\s\S]*?steps\.product_migration\.outcome == 'skipped'[\s\S]*?scripts\/restore-generation-concurrency\.sh/u,
    );
  });
});
