import { streamHandle } from "hono/aws-lambda";

import {
  configurationReleaseIdForInvocation,
  createWebBffRuntime,
} from "./runtime.js";

type StreamingHandler = ReturnType<typeof streamHandle>;
type StreamingResponseHandler = (
  event: Parameters<StreamingHandler>[0],
  responseStream: unknown,
  context: unknown,
) => void | Promise<void>;
type StreamifyResponse = (
  streamingHandler: StreamingResponseHandler,
) => StreamingResponseHandler;

const awslambda = (
  globalThis as typeof globalThis & {
    awslambda?: { streamifyResponse: StreamifyResponse };
  }
).awslambda;
const streamifyResponse: StreamifyResponse =
  awslambda?.streamifyResponse ??
  ((streamingHandler) => streamingHandler);

const runtimes = new Map<string, Promise<StreamingHandler>>();

const getRuntime = (
  invokedFunctionArn: string | undefined,
): Promise<StreamingHandler> => {
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
  ).then((app) => streamHandle(app));
  runtimes.set(key, created);
  return created;
};

export const handler = streamifyResponse(
  async (event, responseStream, context): Promise<void> => {
    const invokedFunctionArn = (
      context as { readonly invokedFunctionArn?: string }
    ).invokedFunctionArn;
    const resolved = (await getRuntime(
      invokedFunctionArn,
    )) as unknown as StreamingResponseHandler;
    await resolved(event, responseStream, context);
  },
);
