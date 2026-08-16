export interface AwsIdentityEvidence {
  readonly account: string;
  readonly arn: string;
}

export interface AwsAccountPlanEvidence {
  readonly accountId: string;
  readonly accountPlanType: "FREE" | "PAID";
  readonly accountPlanStatus: "NOT_STARTED" | "ACTIVE" | "EXPIRED";
  readonly accountPlanRemainingCredits: {
    readonly amount: number;
    readonly unit: string;
  };
  readonly accountPlanExpirationDate: string;
}

export interface AwsLambdaLimitEvidence {
  readonly concurrentExecutions: number;
  readonly unreservedConcurrentExecutions: number;
}

export interface AwsPreflightEvidence {
  readonly checkedAt: string;
  readonly region: string;
  readonly teardownDate: string;
  readonly identity: AwsIdentityEvidence;
  readonly plan: AwsAccountPlanEvidence;
  readonly lambda: AwsLambdaLimitEvidence;
}

export type AwsPreflightFailureCode =
  | "TEMPORARY_ROLE_REQUIRED"
  | "ACCOUNT_MISMATCH"
  | "FREE_PLAN_REQUIRED"
  | "FREE_PLAN_INACTIVE"
  | "FREE_PLAN_CREDITS_EXHAUSTED"
  | "PLAN_EXPIRY_INVALID"
  | "TEARDOWN_DATE_INVALID"
  | "TEARDOWN_NOT_FUTURE"
  | "TEARDOWN_AFTER_PLAN_EXPIRY"
  | "REGION_MISMATCH"
  | "LAMBDA_CONCURRENCY_INSUFFICIENT";

export type AwsPreflightResult =
  | {
      readonly ok: true;
      readonly requiredReservedConcurrency: 13;
      readonly requiredUnreservedConcurrency: 100;
    }
  | {
      readonly ok: false;
      readonly code: AwsPreflightFailureCode;
    };

const REQUIRED_REGION = "eu-central-1";
const REQUIRED_RESERVED_CONCURRENCY = 13;
const REQUIRED_UNRESERVED_CONCURRENCY = 100;
const REQUIRED_ACCOUNT_CONCURRENCY =
  REQUIRED_RESERVED_CONCURRENCY + REQUIRED_UNRESERVED_CONCURRENCY;

function failure(code: AwsPreflightFailureCode): AwsPreflightResult {
  return { ok: false, code };
}

function dateValue(value: string): number | undefined {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function evaluateAwsPreflight(
  evidence: AwsPreflightEvidence,
): AwsPreflightResult {
  const assumedRolePattern = new RegExp(
    `^arn:aws:sts::${evidence.identity.account}:assumed-role/[^/]+/[^/]+$`,
  );
  if (!assumedRolePattern.test(evidence.identity.arn)) {
    return failure("TEMPORARY_ROLE_REQUIRED");
  }

  if (evidence.identity.account !== evidence.plan.accountId) {
    return failure("ACCOUNT_MISMATCH");
  }

  if (evidence.plan.accountPlanType !== "FREE") {
    return failure("FREE_PLAN_REQUIRED");
  }
  if (evidence.plan.accountPlanStatus !== "ACTIVE") {
    return failure("FREE_PLAN_INACTIVE");
  }
  if (
    evidence.plan.accountPlanRemainingCredits.unit !== "USD" ||
    evidence.plan.accountPlanRemainingCredits.amount <= 0
  ) {
    return failure("FREE_PLAN_CREDITS_EXHAUSTED");
  }

  const checkedAt = dateValue(evidence.checkedAt);
  const expiresAt = dateValue(evidence.plan.accountPlanExpirationDate);
  const teardownAt = dateValue(`${evidence.teardownDate}T23:59:59.999Z`);
  if (expiresAt === undefined) {
    return failure("PLAN_EXPIRY_INVALID");
  }
  if (
    checkedAt === undefined ||
    teardownAt === undefined ||
    !/^\d{4}-\d{2}-\d{2}$/.test(evidence.teardownDate)
  ) {
    return failure("TEARDOWN_DATE_INVALID");
  }
  if (teardownAt <= checkedAt) {
    return failure("TEARDOWN_NOT_FUTURE");
  }
  if (teardownAt > expiresAt) {
    return failure("TEARDOWN_AFTER_PLAN_EXPIRY");
  }

  if (evidence.region !== REQUIRED_REGION) {
    return failure("REGION_MISMATCH");
  }

  if (
    evidence.lambda.concurrentExecutions < REQUIRED_ACCOUNT_CONCURRENCY ||
    evidence.lambda.unreservedConcurrentExecutions <
      REQUIRED_ACCOUNT_CONCURRENCY
  ) {
    return failure("LAMBDA_CONCURRENCY_INSUFFICIENT");
  }

  return {
    ok: true,
    requiredReservedConcurrency: REQUIRED_RESERVED_CONCURRENCY,
    requiredUnreservedConcurrency: REQUIRED_UNRESERVED_CONCURRENCY,
  };
}
