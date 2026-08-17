import { handle } from "hono/aws-lambda";

import { createWebBffRuntime } from "./runtime.js";

type BufferedHandler = ReturnType<typeof handle>;

let runtime: BufferedHandler | undefined;

export const handler: BufferedHandler = async (event, context) =>
  await (runtime ??= handle(createWebBffRuntime()))(event, context);
