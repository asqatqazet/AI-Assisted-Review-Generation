import { createGenerationRuntime } from "./runtime.js";

let runtime: ((event: unknown) => Promise<unknown>) | undefined;

const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
};

const decodeKey = (name: string): string =>
  Buffer.from(required(name), "base64").toString("utf8");

const getRuntime = (): ((event: unknown) => Promise<unknown>) => {
  runtime ??= createGenerationRuntime({
    databaseUrl: required("DATABASE_URL"),
    contextPublicKeyPem: decodeKey("CONTEXT_WORK_PUBLIC_KEY_B64"),
    generationPrivateKeyPem: decodeKey("GENERATION_WORK_PRIVATE_KEY_B64"),
    fakeDelayMs: Number.parseInt(process.env["REVIEW_FAKE_DELAY_MS"] ?? "0", 10),
  });
  return runtime;
};

export const handler = async (event: unknown): Promise<unknown> =>
  await getRuntime()(event);
