import { describe, expect, it } from "vitest";

import { evaluateAwsPreflight, type AwsPreflightEvidence } from "./preflight.js";

const validEvidence: AwsPreflightEvidence = {
  checkedAt: "2026-08-17T12:00:00.000Z",
  region: "eu-central-1",
  teardownDate: "2026-10-01",
  identity: {
    account: "123456789012",
    arn: "arn:aws:sts::123456789012:assumed-role/review-deployer/session-1",
  },
  plan: {
    accountId: "123456789012",
    accountPlanType: "FREE",
    accountPlanStatus: "ACTIVE",
    accountPlanRemainingCredits: { amount: 83.5, unit: "USD" },
    accountPlanExpirationDate: "2026-11-30T23:59:59.000Z",
  },
  lambda: {
    concurrentExecutions: 113,
    unreservedConcurrentExecutions: 113,
  },
};

describe("US-06.1 AWS deployment preflight", () => {
  it("accepts the explicit student low-quota profile at the account's ten-concurrency floor", () => {
    expect(
      evaluateAwsPreflight(
        {
          ...validEvidence,
          lambda: {
            concurrentExecutions: 10,
            unreservedConcurrentExecutions: 10,
          },
        },
        "student-low-quota",
      ),
    ).toEqual({
      ok: true,
      deploymentProfile: "student-low-quota",
      requiredAccountConcurrency: 10,
      requiredReservedConcurrency: 0,
      requiredUnreservedConcurrency: 10,
    });
  });

  it("accepts a temporary role on an active funded Free Plan with 13 allocatable units", () => {
    expect(evaluateAwsPreflight(validEvidence)).toEqual({
      ok: true,
      deploymentProfile: "reserved-concurrency",
      requiredAccountConcurrency: 113,
      requiredReservedConcurrency: 13,
      requiredUnreservedConcurrency: 100,
    });
  });

  it.each([
    [
      "root credentials",
      {
        identity: {
          account: "123456789012",
          arn: "arn:aws:iam::123456789012:root",
        },
      },
      "TEMPORARY_ROLE_REQUIRED",
    ],
    [
      "long-lived IAM user credentials",
      {
        identity: {
          account: "123456789012",
          arn: "arn:aws:iam::123456789012:user/student",
        },
      },
      "TEMPORARY_ROLE_REQUIRED",
    ],
    [
      "paid account plan",
      { plan: { ...validEvidence.plan, accountPlanType: "PAID" } },
      "FREE_PLAN_REQUIRED",
    ],
    [
      "expired account plan",
      { plan: { ...validEvidence.plan, accountPlanStatus: "EXPIRED" } },
      "FREE_PLAN_INACTIVE",
    ],
    [
      "exhausted credits",
      {
        plan: {
          ...validEvidence.plan,
          accountPlanRemainingCredits: { amount: 0, unit: "USD" },
        },
      },
      "FREE_PLAN_CREDITS_EXHAUSTED",
    ],
    [
      "late teardown",
      { teardownDate: "2026-12-01" },
      "TEARDOWN_AFTER_PLAN_EXPIRY",
    ],
    [
      "wrong region",
      { region: "eu-west-1" },
      "REGION_MISMATCH",
    ],
    [
      "insufficient allocatable concurrency",
      {
        lambda: {
          concurrentExecutions: 113,
          unreservedConcurrentExecutions: 112,
        },
      },
      "LAMBDA_CONCURRENCY_INSUFFICIENT",
    ],
  ])("rejects %s", (_label, override, expectedCode) => {
    const evidence: AwsPreflightEvidence = {
      ...validEvidence,
      ...override,
    } as AwsPreflightEvidence;

    expect(evaluateAwsPreflight(evidence)).toMatchObject({
      ok: false,
      code: expectedCode,
    });
  });
});
