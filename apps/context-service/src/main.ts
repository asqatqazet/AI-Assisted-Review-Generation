import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

import { createContextRuntime } from "./runtime.js";

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

const getRuntime = (): Promise<(event: unknown) => Promise<unknown>> => {
  runtime ??= Promise.all([
    requiredParameter("CONTEXT_DATABASE_URL_PARAMETER"),
    requiredParameter("CONTEXT_WORK_PRIVATE_KEY_PARAMETER"),
    requiredParameter("GENERATION_WORK_PUBLIC_KEY_PARAMETER"),
  ]).then(([databaseUrl, contextPrivateKeyPem, generationPublicKeyPem]) =>
    createContextRuntime({
      databaseUrl,
      contextPrivateKeyPem,
      generationPublicKeyPem,
      // Distribution links must resolve the real public Survey origin.
      surveyOrigin: required("REVIEW_PUBLIC_ORIGIN"),
    }),
  );
  return runtime;
};

export const handler = async (event: unknown): Promise<unknown> =>
  await (await getRuntime())(event);
