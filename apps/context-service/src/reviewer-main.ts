import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

import { createContextReviewerRuntime } from "./reviewer-runtime.js";

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

const requiredProviderMode = (): "fake-only" | "paid-enabled" => {
  const value = required("REVIEW_PROVIDER_MODE");
  if (value !== "fake-only" && value !== "paid-enabled") {
    throw new Error("REVIEW_PROVIDER_MODE must be fake-only or paid-enabled");
  }
  return value;
};

const getRuntime = (): Promise<(event: unknown) => Promise<unknown>> => {
  const providerMode = requiredProviderMode();
  runtime ??= Promise.all([
    requiredParameter("CONTEXT_RUNTIME_DATABASE_URL_PARAMETER"),
    requiredParameter("CONTEXT_WORK_PRIVATE_KEY_PARAMETER"),
    requiredParameter("GENERATION_WORK_PUBLIC_KEY_PARAMETER"),
    requiredParameter("PUBLIC_SOURCE_RATE_HMAC_SECRET_PARAMETER"),
  ]).then(([
    runtimeDatabaseUrl,
    contextPrivateKeyPem,
    generationPublicKeyPem,
    publicSourceRateHmacSecret,
  ]) =>
    createContextReviewerRuntime({
      runtimeDatabaseUrl,
      contextPrivateKeyPem,
      generationPublicKeyPem,
      publicSourceRateHmacSecret,
      providerMode,
    }),
  );
  return runtime;
};

export const handler = async (event: unknown): Promise<unknown> =>
  await (await getRuntime())(event);
