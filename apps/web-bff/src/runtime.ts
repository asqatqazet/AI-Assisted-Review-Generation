import { LambdaClient } from "@aws-sdk/client-lambda";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

import { createAwsLambdaJsonInvoker } from "./adapters/lambda-json-invoker.js";
import {
  createInvokedContextPort,
  createInvokedReviewerDispositionContextPort,
  createInvokedReviewerGenerationContextPort,
} from "./adapters/context-function.port.js";
import {
  createInvokedReviewerDispositionExecutionPort,
  createInvokedReviewerGenerationExecutionPort,
} from "./adapters/generation-function.port.js";
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

export async function createWebBffRuntime() {
  const client = new LambdaClient({});
  const ssm = new SSMClient({});
  const csrfSecretResponse = await ssm.send(
    new GetParameterCommand({
      Name: required("REVIEW_CSRF_SECRET_PARAMETER"),
      WithDecryption: true,
    }),
  );
  const csrfSecret = csrfSecretResponse.Parameter?.Value;
  if (csrfSecret === undefined || csrfSecret.length === 0) {
    throw new Error("REVIEW_CSRF_SECRET_PARAMETER did not resolve to a value");
  }
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
    reviewerDispositionContextPort:
      createInvokedReviewerDispositionContextPort(contextInvoker),
    reviewerDispositionExecutionPort:
      createInvokedReviewerDispositionExecutionPort(generationInvoker),
    csrfProtector: createHmacCsrfProtector(csrfSecret),
    trustedPublicOriginHeader: "x-review-public-origin",
  });
}
