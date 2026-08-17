import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { prepareLambdaArtifacts } from "./lambda-artifact.js";

describe("Lambda artifact module metadata", () => {
  it("makes every ESM handler parse under Lambda's Node loader semantics", () => {
    const root = mkdtempSync(path.join(tmpdir(), "review-lambda-artifacts-"));
    const artifactDirectories = ["web-bff", "context-service", "generation-service"].map(
      (name) => path.join(root, name),
    );

    for (const directory of artifactDirectories) {
      mkdirSync(directory, { recursive: true });
      writeFileSync(
        path.join(directory, "main.js"),
        'import fs from "node:fs";\nexport const handler = () => fs.constants.F_OK;\n',
        "utf8",
      );
    }

    prepareLambdaArtifacts(artifactDirectories);

    for (const directory of artifactDirectories) {
      expect(JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8"))).toEqual({
        type: "module",
      });

      const syntaxCheck = spawnSync(
        process.execPath,
        ["--no-experimental-detect-module", "--check", path.join(directory, "main.js")],
        { encoding: "utf8" },
      );

      expect(syntaxCheck.status, syntaxCheck.stderr).toBe(0);
    }
  });
});
