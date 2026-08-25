import { LambdaClient } from "@aws-sdk/client-lambda";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

import { createAwsLambdaJsonInvoker } from "./adapters/lambda-json-invoker.js";
import {
  createInvokedConsoleBenchAuthorizationPort,
  createInvokedConsolePort,
  createInvokedConsoleExecutionAuthorizationPort,
  createInvokedContextPort,
  createInvokedOperatorContextPort,
  createInvokedPublicSourceRateLimitPort,
  createInvokedReviewerDispositionContextPort,
  createInvokedReviewerGenerationContextPort,
} from "./adapters/context-function.port.js";
import {
  createInvokedConsoleBenchExecutionPort,
  createInvokedConsoleExecutionReadPort,
  createInvokedReviewerDispositionExecutionPort,
  createInvokedReviewerGenerationExecutionPort,
} from "./adapters/generation-function.port.js";
import {
  createInvokedReviewerDraftRevisionContextPort,
  createInvokedReviewerDraftRevisionExecutionPort,
} from "./adapters/reviewer-draft-revision-function.ports.js";
import { createWebBffApp } from "./app.js";
import { cloudFrontViewerSource } from "./ports/public-source-rate-limit.port.js";
import { createCognitoOperatorAuth } from "./security/cognito-operator-auth.js";
import { createHmacCsrfProtector } from "./security/csrf-protector.js";

const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
};

const configurationReleaseIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function configurationReleaseIdForInvocation(
  invokedFunctionArn: string | undefined,
): string | undefined {
  if (invokedFunctionArn?.endsWith(":candidate") !== true) {
    return undefined;
  }
  const configurationReleaseId = required("REVIEW_CONFIGURATION_RELEASE_ID");
  if (!configurationReleaseIdPattern.test(configurationReleaseId)) {
    throw new Error("REVIEW_CONFIGURATION_RELEASE_ID must be a canonical UUID");
  }
  return configurationReleaseId;
}

const qualifiedAliasArn = (name: string): string => {
  const value = required(name);
  if (!/^arn:aws:lambda:[^:]+:\d{12}:function:[^:]+:[^:]+$/.test(value)) {
    throw new Error(`${name} must be a qualified Lambda alias ARN`);
  }
  return value;
};

interface OperatorOidcConfig {
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly issuer: string;
  readonly jwksUri: string;
  readonly clientId: string;
  readonly redirectUri: string;
}

function parseOperatorOidcConfig(value: string): OperatorOidcConfig {
  const parsed = JSON.parse(value) as unknown;
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("OPERATOR_OIDC_CONFIG_PARAMETER must contain an object");
  }
  const record = parsed as Record<string, unknown>;
  const names = [
    "authorizationEndpoint",
    "tokenEndpoint",
    "issuer",
    "jwksUri",
    "clientId",
    "redirectUri",
  ] as const;
  for (const name of names) {
    if (typeof record[name] !== "string" || record[name].length === 0) {
      throw new Error(`OPERATOR_OIDC_CONFIG_PARAMETER.${name} is required`);
    }
  }
  const config = record as unknown as OperatorOidcConfig;
  const authorization = new URL(config.authorizationEndpoint);
  const token = new URL(config.tokenEndpoint);
  const issuer = new URL(config.issuer);
  const jwks = new URL(config.jwksUri);
  const redirect = new URL(config.redirectUri);
  if (
    authorization.protocol !== "https:" ||
    token.protocol !== "https:" ||
    issuer.protocol !== "https:" ||
    jwks.protocol !== "https:" ||
    redirect.protocol !== "https:" ||
    authorization.origin !== token.origin ||
    jwks.toString() !== `${issuer.toString().replace(/\/$/, "")}/.well-known/jwks.json` ||
    redirect.pathname !== "/auth/callback"
  ) {
    throw new Error("OPERATOR_OIDC_CONFIG_PARAMETER contains invalid endpoints");
  }
  return config;
}

async function requiredParameter(
  ssm: SSMClient,
  environmentName: string,
): Promise<string> {
  const response = await ssm.send(
    new GetParameterCommand({
      Name: required(environmentName),
      WithDecryption: true,
    }),
  );
  const value = response.Parameter?.Value;
  if (value === undefined || value.length === 0) {
    throw new Error(`${environmentName} did not resolve to a value`);
  }
  return value;
}

export async function createWebBffRuntime(
  options: {
    readonly candidateInvocation?: boolean;
    readonly configurationReleaseId?: string;
  } = {},
) {
  const client = new LambdaClient({});
  const ssm = new SSMClient({});
  const configurationReleaseId = options.configurationReleaseId;
  if (
    configurationReleaseId !== undefined &&
    !configurationReleaseIdPattern.test(configurationReleaseId)
  ) {
    throw new Error("REVIEW_CONFIGURATION_RELEASE_ID must be a canonical UUID");
  }
  const [csrfSecret, operatorSessionSecret, oidcConfigValue] = await Promise.all([
    requiredParameter(ssm, "REVIEW_CSRF_SECRET_PARAMETER"),
    requiredParameter(ssm, "OPERATOR_SESSION_SECRET_PARAMETER"),
    requiredParameter(ssm, "OPERATOR_OIDC_CONFIG_PARAMETER"),
  ]);
  const oidcConfig = parseOperatorOidcConfig(oidcConfigValue);
  const reviewerInvoker = createAwsLambdaJsonInvoker(
    client,
    qualifiedAliasArn("CONTEXT_REVIEWER_FUNCTION_ALIAS_ARN"),
  );
  const consoleInvoker = createAwsLambdaJsonInvoker(
    client,
    qualifiedAliasArn("CONTEXT_CONSOLE_FUNCTION_ALIAS_ARN"),
  );
  const generationVersionArn =
    options.candidateInvocation === true
      ? qualifiedAliasArn("GENERATION_CANDIDATE_FUNCTION_ALIAS_ARN")
      : qualifiedAliasArn("GENERATION_FUNCTION_ALIAS_ARN");
  const generationInvoker = createAwsLambdaJsonInvoker(
    client,
    generationVersionArn,
  );

  return createWebBffApp({
    operatorAuth: createCognitoOperatorAuth({
      ...oidcConfig,
      sessionSecret: operatorSessionSecret,
    }),
    operatorContextPort: createInvokedOperatorContextPort(consoleInvoker),
    consolePort: createInvokedConsolePort(consoleInvoker),
    consoleExecutionAuthorizationPort:
      createInvokedConsoleExecutionAuthorizationPort(consoleInvoker),
    consoleExecutionReadPort:
      createInvokedConsoleExecutionReadPort(generationInvoker),
    consoleBenchAuthorizationPort:
      createInvokedConsoleBenchAuthorizationPort(consoleInvoker),
    consoleBenchExecutionPort:
      createInvokedConsoleBenchExecutionPort(generationInvoker),
    contextPort:
      configurationReleaseId === undefined
        ? createInvokedContextPort(reviewerInvoker)
        : createInvokedContextPort(reviewerInvoker, {
            configurationReleaseId,
          }),
    sourceRateLimitPort:
      createInvokedPublicSourceRateLimitPort(reviewerInvoker),
    resolveTrustedViewerSource: cloudFrontViewerSource,
    reviewerGenerationContextPort:
      createInvokedReviewerGenerationContextPort(reviewerInvoker),
    reviewerGenerationExecutionPort:
      createInvokedReviewerGenerationExecutionPort(generationInvoker),
    reviewerDispositionContextPort:
      createInvokedReviewerDispositionContextPort(reviewerInvoker),
    reviewerDispositionExecutionPort:
      createInvokedReviewerDispositionExecutionPort(generationInvoker),
    reviewerDraftRevisionContextPort:
      createInvokedReviewerDraftRevisionContextPort(reviewerInvoker),
    reviewerDraftRevisionExecutionPort:
      createInvokedReviewerDraftRevisionExecutionPort(generationInvoker),
    csrfProtector: createHmacCsrfProtector(csrfSecret),
    trustedPublicOriginHeader: "x-review-public-origin",
  });
}
