import { handle } from "hono/aws-lambda";

import { createWebBffRuntime } from "./runtime.js";

type BufferedHandler = ReturnType<typeof handle>;

let runtime: Promise<BufferedHandler> | undefined;

const getRuntime = (): Promise<BufferedHandler> =>
  (runtime ??= createWebBffRuntime().then((app) => handle(app)));

export const handler: BufferedHandler = async (event, context) =>
  await (await getRuntime())(event, context);
