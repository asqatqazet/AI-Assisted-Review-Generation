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

    prepareLambdaArtifacts(
      artifactDirectories.map((directory) => ({ directory })),
    );

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

  it("copies platform-specific runtime files beside a bundled handler", () => {
    const root = mkdtempSync(path.join(tmpdir(), "review-lambda-runtime-files-"));
    const artifactDirectory = path.join(root, "context-service");
    const generatedClientDirectory = path.join(root, "generated-client");
    const engineName = "libquery_engine-rhel-openssl-3.0.x.so.node";
    const engineSource = path.join(generatedClientDirectory, engineName);
    const schemaSource = path.join(generatedClientDirectory, "schema.prisma");
    mkdirSync(artifactDirectory, { recursive: true });
    mkdirSync(generatedClientDirectory, { recursive: true });
    writeFileSync(path.join(artifactDirectory, "main.js"), "export const handler = () => 1;\n");
    writeFileSync(engineSource, "native-engine-fixture", "utf8");
    writeFileSync(schemaSource, "generator client {}\n", "utf8");

    prepareLambdaArtifacts([
      {
        directory: artifactDirectory,
        runtimeFiles: [engineSource, schemaSource],
      },
    ]);

    expect(readFileSync(path.join(artifactDirectory, engineName), "utf8")).toBe(
      "native-engine-fixture",
    );
    expect(readFileSync(path.join(artifactDirectory, "schema.prisma"), "utf8")).toBe(
      "generator client {}\n",
    );
  });
});
