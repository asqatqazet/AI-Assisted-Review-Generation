import { prepareLambdaArtifacts } from "./lambda-artifact.js";

const lambdaEngine = "libquery_engine-rhel-openssl-3.0.x.so.node";

prepareLambdaArtifacts([
  { directory: "dist/apps/web-bff" },
  {
    directory: "dist/apps/context-service",
    runtimeFiles: [
      `packages/db/src/generated/admission/${lambdaEngine}`,
      "packages/db/src/generated/admission/schema.prisma",
    ],
  },
  {
    directory: "dist/apps/generation-service",
    runtimeFiles: [
      `packages/db/src/generated/execution-plane/${lambdaEngine}`,
      "packages/db/src/generated/execution-plane/schema.prisma",
    ],
  },
]);
