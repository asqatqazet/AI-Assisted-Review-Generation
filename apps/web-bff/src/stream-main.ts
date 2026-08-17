import { streamHandle } from "hono/aws-lambda";

import { createWebBffRuntime } from "./runtime.js";

type StreamingHandler = ReturnType<typeof streamHandle>;

let runtime: Promise<StreamingHandler> | undefined;

const getRuntime = (): Promise<StreamingHandler> =>
  (runtime ??= createWebBffRuntime().then((app) => streamHandle(app)));

export const handler: StreamingHandler = (event, context, callback) =>
  void getRuntime()
    .then((resolved) => resolved(event, context, callback))
    .catch((error: unknown) =>
      callback(error instanceof Error ? error : new Error("BFF_INIT_FAILED")),
    );
