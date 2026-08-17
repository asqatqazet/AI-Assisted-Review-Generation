import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";

const lambdaModuleMetadata = `${JSON.stringify({ type: "module" }, null, 2)}\n`;

export function prepareLambdaArtifacts(artifactDirectories: readonly string[]): void {
  for (const directory of artifactDirectories) {
    if (!existsSync(directory)) {
      throw new Error(`Lambda artifact directory does not exist: ${directory}`);
    }

    writeFileSync(path.join(directory, "package.json"), lambdaModuleMetadata, "utf8");
  }
}
