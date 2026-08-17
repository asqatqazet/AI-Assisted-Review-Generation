import { prepareLambdaArtifacts } from "./lambda-artifact.js";

const artifactDirectories = process.argv.slice(2);

if (artifactDirectories.length === 0) {
  throw new Error("At least one Lambda artifact directory is required");
}

prepareLambdaArtifacts(artifactDirectories);
