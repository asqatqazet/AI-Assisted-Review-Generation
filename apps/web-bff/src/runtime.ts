import { LambdaClient } from "@aws-sdk/client-lambda";

import { createAwsLambdaJsonInvoker } from "./adapters/lambda-json-invoker.js";
import {
  createInvokedContextPort,
  createInvokedReviewerGenerationContextPort,
} from "./adapters/context-function.port.js";
import { createInvokedReviewerGenerationExecutionPort } from "./adapters/generation-function.port.js";
import { createWebBffApp } from "./app.js";
import { createHmacCsrfProtector } from "./security/csrf-protector.js";

const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
};

const qualifiedAliasArn = (name: string): string => {
  const value = required(name);
  if (!/^arn:aws:lambda:[^:]+:\d{12}:function:[^:]+:[^:]+$/.test(value)) {
    throw new Error(`${name} must be a qualified Lambda alias ARN`);
  }
  return value;
};

export function createWebBffRuntime() {
  const client = new LambdaClient({});
  const contextInvoker = createAwsLambdaJsonInvoker(
    client,
    qualifiedAliasArn("CONTEXT_FUNCTION_ALIAS_ARN"),
  );
  const generationInvoker = createAwsLambdaJsonInvoker(
    client,
    qualifiedAliasArn("GENERATION_FUNCTION_ALIAS_ARN"),
  );

  return createWebBffApp({
    contextPort: createInvokedContextPort(contextInvoker),
    reviewerGenerationContextPort:
      createInvokedReviewerGenerationContextPort(contextInvoker),
    reviewerGenerationExecutionPort:
      createInvokedReviewerGenerationExecutionPort(generationInvoker),
    csrfProtector: createHmacCsrfProtector(required("REVIEW_CSRF_SECRET")),
    publicOrigin: required("REVIEW_PUBLIC_ORIGIN"),
  });
}
