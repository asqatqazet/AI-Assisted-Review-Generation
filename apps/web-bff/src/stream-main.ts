import { streamHandle } from "hono/aws-lambda";

import { createWebBffRuntime } from "./runtime.js";

type StreamingHandler = ReturnType<typeof streamHandle>;

let runtime: StreamingHandler | undefined;

export const handler: StreamingHandler = (event, context, callback) =>
  (runtime ??= streamHandle(createWebBffRuntime()))(event, context, callback);
