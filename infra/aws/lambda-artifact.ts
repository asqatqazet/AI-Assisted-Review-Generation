import { copyFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";

const lambdaModuleMetadata = `${JSON.stringify({ type: "module" }, null, 2)}\n`;

export interface LambdaArtifactSpec {
  readonly directory: string;
  readonly runtimeFiles?: readonly string[];
}

export function prepareLambdaArtifacts(artifacts: readonly LambdaArtifactSpec[]): void {
  for (const { directory, runtimeFiles = [] } of artifacts) {
    if (!existsSync(directory)) {
      throw new Error(`Lambda artifact directory does not exist: ${directory}`);
    }

    writeFileSync(path.join(directory, "package.json"), lambdaModuleMetadata, "utf8");

    for (const source of runtimeFiles) {
      if (!existsSync(source)) {
        throw new Error(`Lambda runtime file does not exist: ${source}`);
      }
      copyFileSync(source, path.join(directory, path.basename(source)));
    }
  }
}
