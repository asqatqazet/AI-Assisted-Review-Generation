import { LambdaClient } from "@aws-sdk/client-lambda";

import { createInvokedReconciliationContextPort } from "./adapters/context-function.port.js";
import { createInvokedReconciliationGenerationPort } from "./adapters/generation-function.port.js";
import { createAwsLambdaJsonInvoker } from "./adapters/lambda-json-invoker.js";
import { createStaleGenerationReconciler } from "./reconciliation.js";

const qualifiedAliasArn = (name: string): string => {
  const value = process.env[name];
  if (
    value === undefined ||
    !/^arn:aws:lambda:[^:]+:\d{12}:function:[^:]+:[^:]+$/.test(value)
  ) {
    throw new Error(`${name} must be a qualified Lambda alias ARN`);
  }
  return value;
};

let reconcile: (() => Promise<unknown>) | undefined;

const createRuntime = (): (() => Promise<unknown>) => {
  const client = new LambdaClient({});
  const context = createInvokedReconciliationContextPort(
    createAwsLambdaJsonInvoker(
      client,
      qualifiedAliasArn("CONTEXT_REVIEWER_FUNCTION_ALIAS_ARN"),
    ),
  );
  const generation = createInvokedReconciliationGenerationPort(
    createAwsLambdaJsonInvoker(
      client,
      qualifiedAliasArn("GENERATION_FUNCTION_ALIAS_ARN"),
    ),
  );
  return createStaleGenerationReconciler({ context, generation, limit: 25 });
};

export const handler = async (): Promise<unknown> =>
  await (reconcile ??= createRuntime())();
