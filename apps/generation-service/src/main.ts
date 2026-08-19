import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

import { createGenerationRuntime } from "./runtime.js";

let runtime: Promise<(event: unknown) => Promise<unknown>> | undefined;
const ssm = new SSMClient({});

const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
};

const requiredParameter = async (name: string): Promise<string> => {
  const response = await ssm.send(
    new GetParameterCommand({ Name: required(name), WithDecryption: true }),
  );
  const value = response.Parameter?.Value;
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} did not resolve to a value`);
  }
  return value;
};

/**
 * A live provider key is optional. When the parameter is absent the runtime
 * keeps the deterministic provider, so a deployment never starts making paid
 * calls just because the plumbing exists.
 */
const optionalParameter = async (name: string): Promise<string | undefined> => {
  const parameterName = process.env[name];
  if (parameterName === undefined || parameterName.length === 0) {
    return undefined;
  }
  try {
    const response = await ssm.send(
      new GetParameterCommand({ Name: parameterName, WithDecryption: true }),
    );
    const value = response.Parameter?.Value;
    return value === undefined || value.length === 0 ? undefined : value;
  } catch {
    return undefined;
  }
};

const getRuntime = (): Promise<(event: unknown) => Promise<unknown>> => {
  runtime ??= Promise.all([
    requiredParameter("GENERATION_DATABASE_URL_PARAMETER"),
    requiredParameter("CONTEXT_WORK_PUBLIC_KEY_PARAMETER"),
    requiredParameter("GENERATION_WORK_PRIVATE_KEY_PARAMETER"),
    optionalParameter("GEMINI_API_KEY_PARAMETER"),
  ]).then(([databaseUrl, contextPublicKeyPem, generationPrivateKeyPem, geminiApiKey]) =>
    createGenerationRuntime({
      databaseUrl,
      contextPublicKeyPem,
      generationPrivateKeyPem,
      geminiApiKey,
      fakeDelayMs: Number.parseInt(
        process.env["REVIEW_FAKE_DELAY_MS"] ?? "0",
        10,
      ),
    }),
  );
  return runtime;
};

export const handler = async (event: unknown): Promise<unknown> =>
  await (await getRuntime())(event);
