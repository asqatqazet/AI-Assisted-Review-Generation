import { createContextRuntime } from "./runtime.js";

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
  runtime ??= createContextRuntime({
    databaseUrl: required("DATABASE_URL"),
    contextPrivateKeyPem: decodeKey("CONTEXT_WORK_PRIVATE_KEY_B64"),
    generationPublicKeyPem: decodeKey("GENERATION_WORK_PUBLIC_KEY_B64"),
  });
  return runtime;
};

export const handler = async (event: unknown): Promise<unknown> =>
  await getRuntime()(event);
