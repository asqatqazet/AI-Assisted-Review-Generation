import { describe, expect, it } from "vitest";

import { collectAwsPreflightEvidence } from "./preflight-cli.js";

describe("US-06.1 AWS CLI preflight adapter", () => {
  it("collects only identity, Free Plan and regional Lambda limit evidence", async () => {
    const calls: string[][] = [];
    const run = async (args: readonly string[]): Promise<string> => {
      calls.push([...args]);
      switch (args[0]) {
        case "sts":
          return JSON.stringify({
            Account: "123456789012",
            Arn: "arn:aws:sts::123456789012:assumed-role/review-deployer/run-1",
          });
        case "freetier":
          return JSON.stringify({
            accountId: "123456789012",
            accountPlanType: "FREE",
            accountPlanStatus: "ACTIVE",
            accountPlanRemainingCredits: { amount: 80, unit: "USD" },
            accountPlanExpirationDate: "2026-11-30T23:59:59.000Z",
          });
        case "lambda":
          return JSON.stringify({
            AccountLimit: {
              ConcurrentExecutions: 150,
              UnreservedConcurrentExecutions: 120,
            },
          });
        default:
          throw new Error(`unexpected command ${args.join(" ")}`);
      }
    };

    await expect(
      collectAwsPreflightEvidence({
        run,
        region: "eu-central-1",
        teardownDate: "2026-10-01",
        checkedAt: "2026-08-17T12:00:00.000Z",
      }),
    ).resolves.toMatchObject({
      identity: { account: "123456789012" },
      plan: { accountPlanType: "FREE" },
      lambda: {
        concurrentExecutions: 150,
        unreservedConcurrentExecutions: 120,
      },
    });

    expect(calls).toEqual([
      ["sts", "get-caller-identity", "--output", "json", "--no-cli-pager"],
      [
        "freetier",
        "get-account-plan-state",
        "--output",
        "json",
        "--no-cli-pager",
      ],
      [
        "lambda",
        "get-account-settings",
        "--region",
        "eu-central-1",
        "--output",
        "json",
        "--no-cli-pager",
      ],
    ]);
  });
});
