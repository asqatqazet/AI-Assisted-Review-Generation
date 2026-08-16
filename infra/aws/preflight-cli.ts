import type {
  AwsAccountPlanEvidence,
  AwsPreflightEvidence,
} from "./preflight.js";

export interface AwsCliRunner {
  (args: readonly string[]): Promise<string>;
}

export interface CollectAwsPreflightOptions {
  readonly run: AwsCliRunner;
  readonly region: string;
  readonly teardownDate: string;
  readonly checkedAt: string;
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function parseObject(value: string, label: string): Record<string, unknown> {
  try {
    return objectValue(JSON.parse(value) as unknown, label);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`${label} returned invalid JSON`, { cause: error });
    }
    throw error;
  }
}

function stringValue(
  source: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const value = source[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label}.${key} must be a non-empty string`);
  }
  return value;
}

function numberValue(
  source: Record<string, unknown>,
  key: string,
  label: string,
): number {
  const value = source[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label}.${key} must be a finite number`);
  }
  return value;
}

function planType(value: string): AwsAccountPlanEvidence["accountPlanType"] {
  if (value !== "FREE" && value !== "PAID") {
    throw new Error("FreeTier.accountPlanType is unsupported");
  }
  return value;
}

function planStatus(
  value: string,
): AwsAccountPlanEvidence["accountPlanStatus"] {
  if (value !== "NOT_STARTED" && value !== "ACTIVE" && value !== "EXPIRED") {
    throw new Error("FreeTier.accountPlanStatus is unsupported");
  }
  return value;
}

export async function collectAwsPreflightEvidence({
  run,
  region,
  teardownDate,
  checkedAt,
}: CollectAwsPreflightOptions): Promise<AwsPreflightEvidence> {
  const identityJson = parseObject(
    await run([
      "sts",
      "get-caller-identity",
      "--output",
      "json",
      "--no-cli-pager",
    ]),
    "STS",
  );
  const planJson = parseObject(
    await run([
      "freetier",
      "get-account-plan-state",
      "--output",
      "json",
      "--no-cli-pager",
    ]),
    "FreeTier",
  );
  const lambdaJson = parseObject(
    await run([
      "lambda",
      "get-account-settings",
      "--region",
      region,
      "--output",
      "json",
      "--no-cli-pager",
    ]),
    "Lambda",
  );

  const remainingCredits = objectValue(
    planJson["accountPlanRemainingCredits"],
    "FreeTier.accountPlanRemainingCredits",
  );
  const accountLimit = objectValue(
    lambdaJson["AccountLimit"],
    "Lambda.AccountLimit",
  );

  return {
    checkedAt,
    region,
    teardownDate,
    identity: {
      account: stringValue(identityJson, "Account", "STS"),
      arn: stringValue(identityJson, "Arn", "STS"),
    },
    plan: {
      accountId: stringValue(planJson, "accountId", "FreeTier"),
      accountPlanType: planType(
        stringValue(planJson, "accountPlanType", "FreeTier"),
      ),
      accountPlanStatus: planStatus(
        stringValue(planJson, "accountPlanStatus", "FreeTier"),
      ),
      accountPlanRemainingCredits: {
        amount: numberValue(
          remainingCredits,
          "amount",
          "FreeTier.accountPlanRemainingCredits",
        ),
        unit: stringValue(
          remainingCredits,
          "unit",
          "FreeTier.accountPlanRemainingCredits",
        ),
      },
      accountPlanExpirationDate: stringValue(
        planJson,
        "accountPlanExpirationDate",
        "FreeTier",
      ),
    },
    lambda: {
      concurrentExecutions: numberValue(
        accountLimit,
        "ConcurrentExecutions",
        "Lambda.AccountLimit",
      ),
      unreservedConcurrentExecutions: numberValue(
        accountLimit,
        "UnreservedConcurrentExecutions",
        "Lambda.AccountLimit",
      ),
    },
  };
}
