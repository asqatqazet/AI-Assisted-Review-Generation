import { streamHandle } from "hono/aws-lambda";

import { createWebBffRuntime } from "./runtime.js";

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

let runtime: Promise<StreamingHandler> | undefined;

const getRuntime = (): Promise<StreamingHandler> =>
  (runtime ??= createWebBffRuntime().then((app) => streamHandle(app)));

export const handler = streamifyResponse(
  async (event, responseStream, context): Promise<void> => {
    const resolved = (await getRuntime()) as unknown as StreamingResponseHandler;
    await resolved(event, responseStream, context);
  },
);
