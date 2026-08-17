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

export type AwsDeploymentProfile =
  | "reserved-concurrency"
  | "student-low-quota";

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
      readonly deploymentProfile: AwsDeploymentProfile;
      readonly requiredAccountConcurrency: number;
      readonly requiredReservedConcurrency: number;
      readonly requiredUnreservedConcurrency: number;
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
const STUDENT_LOW_QUOTA_ACCOUNT_CONCURRENCY = 10;

function failure(code: AwsPreflightFailureCode): AwsPreflightResult {
  return { ok: false, code };
}

function dateValue(value: string): number | undefined {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function evaluateAwsPreflight(
  evidence: AwsPreflightEvidence,
  deploymentProfile: AwsDeploymentProfile = "reserved-concurrency",
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

  const requiredAccountConcurrency =
    deploymentProfile === "student-low-quota"
      ? STUDENT_LOW_QUOTA_ACCOUNT_CONCURRENCY
      : REQUIRED_ACCOUNT_CONCURRENCY;
  if (
    evidence.lambda.concurrentExecutions < requiredAccountConcurrency ||
    evidence.lambda.unreservedConcurrentExecutions < requiredAccountConcurrency
  ) {
    return failure("LAMBDA_CONCURRENCY_INSUFFICIENT");
  }

  return deploymentProfile === "student-low-quota"
    ? {
        ok: true,
        deploymentProfile,
        requiredAccountConcurrency,
        requiredReservedConcurrency: 0,
        requiredUnreservedConcurrency: STUDENT_LOW_QUOTA_ACCOUNT_CONCURRENCY,
      }
    : {
        ok: true,
        deploymentProfile,
        requiredAccountConcurrency,
        requiredReservedConcurrency: REQUIRED_RESERVED_CONCURRENCY,
        requiredUnreservedConcurrency: REQUIRED_UNRESERVED_CONCURRENCY,
      };
}
