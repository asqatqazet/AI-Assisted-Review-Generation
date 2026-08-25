import { handle } from "hono/aws-lambda";

import {
  configurationReleaseIdForInvocation,
  createWebBffRuntime,
} from "./runtime.js";

type BufferedHandler = ReturnType<typeof handle>;

const runtimes = new Map<string, Promise<BufferedHandler>>();

const getRuntime = (invokedFunctionArn: string | undefined): Promise<BufferedHandler> => {
  const configurationReleaseId =
    configurationReleaseIdForInvocation(invokedFunctionArn);
  const key = configurationReleaseId ?? "live";
  const existing = runtimes.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const created = createWebBffRuntime(
    configurationReleaseId === undefined
      ? {}
      : { candidateInvocation: true, configurationReleaseId },
  ).then((app) => handle(app));
  runtimes.set(key, created);
  return created;
};

export const handler: BufferedHandler = async (event, context) =>
  await (await getRuntime(context?.invokedFunctionArn))(event, context);
