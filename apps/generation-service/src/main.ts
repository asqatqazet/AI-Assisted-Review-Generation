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
 * A live provider key is optional at deployment. Absence disables that paid
 * adapter; it never changes the Provider route resolved in the snapshot and
 * therefore cannot trigger fallback or a surprise paid call.
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

const requiredProviderMode = (): "fake-only" | "paid-enabled" => {
  const providerMode = required("REVIEW_PROVIDER_MODE");
  if (providerMode !== "fake-only" && providerMode !== "paid-enabled") {
    throw new Error("REVIEW_PROVIDER_MODE must be fake-only or paid-enabled");
  }
  return providerMode;
};

const getRuntime = (): Promise<(event: unknown) => Promise<unknown>> => {
  const providerMode = requiredProviderMode();
  runtime ??= Promise.all([
    requiredParameter("GENERATION_DATABASE_URL_PARAMETER"),
    requiredParameter("CONTEXT_WORK_PUBLIC_KEY_PARAMETER"),
    requiredParameter("CONSOLE_AUTHORITY_PUBLIC_KEY_PEM_PARAMETER"),
    requiredParameter("GENERATION_WORK_PRIVATE_KEY_PARAMETER"),
    providerMode === "paid-enabled"
      ? optionalParameter("GEMINI_API_KEY_PARAMETER")
      : Promise.resolve(undefined),
    providerMode === "paid-enabled"
      ? optionalParameter("OPENAI_API_KEY_PARAMETER")
      : Promise.resolve(undefined),
  ]).then(([
    databaseUrl,
    contextPublicKeyPem,
    consoleAuthorityPublicKeyPem,
    generationPrivateKeyPem,
    geminiApiKey,
    openaiApiKey,
  ]) =>
    createGenerationRuntime({
      databaseUrl,
      providerMode,
      contextPublicKeyPem,
      consoleAuthorityPublicKeyPem,
      generationPrivateKeyPem,
      geminiApiKey,
      openaiApiKey,
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
