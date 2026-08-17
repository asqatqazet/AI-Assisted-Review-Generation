import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  assertTemporaryCredentialSource,
  collectAwsPreflightEvidence,
  deploymentProfileFromEnvironment,
  type AwsCliRunner,
} from "./preflight-cli.js";
import { evaluateAwsPreflight } from "./preflight.js";

const execFileAsync = promisify(execFile);

function createAwsCliRunner(profile: string | undefined): AwsCliRunner {
  return async (args) => {
    const profileArgs = profile === undefined ? [] : ["--profile", profile];
    const { stdout } = await execFileAsync("aws", [...args, ...profileArgs], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    return stdout;
  };
}

async function main(): Promise<void> {
  assertTemporaryCredentialSource(process.env);
  const deploymentProfile = deploymentProfileFromEnvironment(process.env);

  const teardownDate = process.env["REVIEW_TEARDOWN_DATE"];
  if (teardownDate === undefined) {
    throw new Error("REVIEW_TEARDOWN_DATE_REQUIRED");
  }

  const region = "eu-central-1";
  const evidence = await collectAwsPreflightEvidence({
    run: createAwsCliRunner(process.env["AWS_PROFILE"]),
    region,
    teardownDate,
    checkedAt: new Date().toISOString(),
  });
  const result = evaluateAwsPreflight(evidence, deploymentProfile);

  process.stdout.write(
    `${JSON.stringify({
      ...result,
      deploymentProfile,
      accountId: evidence.identity.account,
      region,
      teardownDate,
      planExpiresAt: evidence.plan.accountPlanExpirationDate,
      remainingCredits: evidence.plan.accountPlanRemainingCredits,
      unreservedConcurrentExecutions:
        evidence.lambda.unreservedConcurrentExecutions,
    })}\n`,
  );
  if (!result.ok) {
    process.exitCode = 1;
  }
}

void main().catch(() => {
  process.stderr.write(
    `${JSON.stringify({ ok: false, code: "AWS_PREFLIGHT_COMMAND_FAILED" })}\n`,
  );
  process.exitCode = 1;
});
