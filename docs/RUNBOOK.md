# Operational Runbook & Incident Response

## 1. Instant Lambda Rollback (Alias Shift)

Lambda functions are invoked through the `live` alias. Rolling back does not require re-building or re-uploading code artifacts; it only requires pointing the `live` alias to the previous verified version.

### Execution Command:
```bash
# 1. Inspect previous published versions
aws lambda list-versions-by-function \
  --function-name review-generation-service-student \
  --query "Versions[-3:].{Version:Version,Created:LastModified}"

# 2. Shift the live alias to target previous stable version (e.g., version 4)
aws lambda update-alias \
  --function-name review-generation-service-student \
  --name live \
  --function-version 4

# 3. Verify health of rolled-back endpoint
curl -f https://<function-url-id>.lambda-url.eu-west-1.on.aws/health
```

---

## 2. Reconstructing Generation Inputs by ID

Because generation requests are idempotent and snapshot-driven:
1. Query the audit event or telemetry log using `generationId`:
   ```bash
   aws logs filter-log-events \
     --log-group-name /aws/lambda/review-generation-service-student \
     --filter-pattern '{ $.generationId = "gen-1723580000000" }'
   ```
2. Retrieve the immutable `ResolvedConfigSnapshot` corresponding to `snapshotId`:
   ```bash
   curl -H "If-None-Match: \"sha256:...\"" https://<context-service-url>/context/tenant-a/loc-1
   ```
3. Re-run locally with `FakeModelGateway` or provider mock to reproduce output bit-for-bit.

---

## 3. Emergency Tenant Disabling

If a tenant exceeds limits or suffers an abuse incident:
```bash
# Update tenant status to SUSPENDED via Context Service control plane
curl -X PATCH https://<context-service-url>/tenants/tenant-apex \
  -H "Authorization: Bearer $PLATFORM_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "SUSPENDED"}'
```
All subsequent entry link resolutions and generation requests for this tenant will immediately fail-closed.

---

## 4. Provider API Key Zero-Downtime Rotation

Provider keys are stored in AWS SSM Parameter Store as `SecureString`:
```bash
# 1. Update parameter in SSM
aws ssm put-parameter \
  --name "/review-gen/student/anthropic_api_key" \
  --type "SecureString" \
  --value "sk-ant-new-key-value" \
  --overwrite

# 2. Trigger graceful Lambda reload by publishing a new configuration revision
aws lambda update-function-configuration \
  --function-name review-generation-service-student \
  --environment "Variables={RELOAD_TRIGGER=$(date +%s)}"
```

---

## 5. Alarm Definitions & Triage

| Alarm | Threshold | Impact | Immediate Action |
|---|---|---|---|
| `BudgetHardLimitAlarm` | Cost > $10/mo | Monetary limit | Inspect top tenant spend in CloudWatch metrics; verify rate limiting. |
| `GroundingRejectionSpike` | Rejections > 5% in 5m | Model drift / Prompt hallucination | Roll back prompt version to prior candidate; run `pnpm eval:golden`. |
| `CircuitBreakerTripped` | 5 consecutive LLM errors | Provider outage | Resilient gateway automatically falls back to secondary provider. |

---

## 6. Recorded Rollback Drill

### Scenario:
Deploying broken generation service candidate build (v5) causing 500 error on `/generate`, observing failure in automated smoke test, and rolling back to stable version (v4).

### Logged Drill Execution:
```text
[2026-08-13T22:30:00Z] DEPLOY: Shifting review-generation-service-student:live to version 5
[2026-08-13T22:30:15Z] SMOKE-TEST: POST /generate -> HTTP 500 Internal Server Error (Assertion failure)
[2026-08-13T22:30:20Z] INCIDENT-ALERT: Smoke test failed on build v5. Initiating rollback.
[2026-08-13T22:30:22Z] EXEC: aws lambda update-alias --function-name review-generation-service-student --name live --function-version 4
[2026-08-13T22:30:25Z] ROLLBACK-COMPLETE: Alias 'live' repointed to version 4 (Duration: 3 seconds)
[2026-08-13T22:30:30Z] SMOKE-TEST: POST /generate -> HTTP 200 OK (Grounding pass)
[2026-08-13T22:30:32Z] STATUS: Green restored. Total MTTR: 32 seconds.
```
