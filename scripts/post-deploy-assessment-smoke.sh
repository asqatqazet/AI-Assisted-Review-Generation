#!/usr/bin/env bash
set -euo pipefail

: "${DOMAIN:?DOMAIN is required}"
: "${TF_DIR:?TF_DIR is required}"
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${RELEASE_DIR:?RELEASE_DIR is required}"
: "${EXPECTED_RELEASE_SHA:?EXPECTED_RELEASE_SHA is required}"

readonly TENANT_ID="00000000-0000-4000-8000-000000000101"
readonly LOCATION_ID="00000000-0000-4000-8000-000000000102"
readonly PUBLIC_ORIGIN="https://${DOMAIN}"
readonly EVIDENCE_DIR="${RELEASE_DIR}/evidence"
readonly COOKIE_JAR="${RUNNER_TEMP:-/tmp}/assessment-reviewer.cookies"
mkdir -p "$EVIDENCE_DIR"
trap 'rm -f "$COOKIE_JAR"' EXIT

invoke_live() {
  local function_name="$1"
  local payload="$2"
  local output_file="$3"
  local metadata
  metadata="$(
    aws lambda invoke \
      --function-name "$function_name" \
      --qualifier live \
      --cli-binary-format raw-in-base64-out \
      --payload "$payload" \
      "$output_file"
  )"
  if [ "$(jq -r '.FunctionError // empty' <<< "$metadata")" != "" ]; then
    echo "::error::Assessment invocation failed for ${function_name}." >&2
    return 1
  fi
}

OPERATOR_ISSUER="$(terraform -chdir="$TF_DIR" output -raw operator_oidc_issuer)"
PLATFORM_EMAIL="$(terraform -chdir="$TF_DIR" output -raw operator_email)"
PLATFORM_SUBJECT="$(terraform -chdir="$TF_DIR" output -raw operator_subject)"
TENANT_EMAIL="$(terraform -chdir="$TF_DIR" output -raw tenant_operator_email)"
TENANT_SUBJECT="$(terraform -chdir="$TF_DIR" output -raw tenant_operator_subject)"
test -n "$OPERATOR_ISSUER"
test -n "$PLATFORM_SUBJECT"
test -n "$TENANT_SUBJECT"
test "$PLATFORM_EMAIL" != "$TENANT_EMAIL"

PLATFORM_IDENTITY="$(jq -cn \
  --arg issuer "$OPERATOR_ISSUER" \
  --arg subject "$PLATFORM_SUBJECT" \
  --arg email "$PLATFORM_EMAIL" \
  '{issuer:$issuer,subject:$subject,email:$email}')"
TENANT_IDENTITY="$(jq -cn \
  --arg issuer "$OPERATOR_ISSUER" \
  --arg subject "$TENANT_SUBJECT" \
  --arg email "$TENANT_EMAIL" \
  '{issuer:$issuer,subject:$subject,email:$email}')"

PLATFORM_ACCESS_EVENT="$(jq -cn --argjson identity "$PLATFORM_IDENTITY" \
  '{operation:"resolve-operator-access",input:{identity:$identity}}')"
invoke_live review-context-console-student "$PLATFORM_ACCESS_EVENT" \
  "$RUNNER_TEMP/platform-access.json"
jq -e '
  .operation == "resolve-operator-access" and
  .result.status == "authorized" and
  any(.result.platformGrants[]; any(.capabilities[]; . == "platform:admin"))
' "$RUNNER_TEMP/platform-access.json" >/dev/null

TENANT_ACCESS_EVENT="$(jq -cn --argjson identity "$TENANT_IDENTITY" \
  '{operation:"resolve-operator-access",input:{identity:$identity}}')"
invoke_live review-context-console-student "$TENANT_ACCESS_EVENT" \
  "$RUNNER_TEMP/tenant-access.json"
jq -e --arg tenantId "$TENANT_ID" '
  .operation == "resolve-operator-access" and
  .result.status == "authorized" and
  (.result.platformGrants | length) == 0 and
  (.result.tenantGrants | length) == 1 and
  .result.tenantGrants[0].tenantId == $tenantId and
  any(.result.tenantGrants[0].capabilities[]; . == "tenant:configure")
' "$RUNNER_TEMP/tenant-access.json" >/dev/null

# A Tenant identity asking for the Platform tenant catalogue receives the same
# generic result as an unknown scope; no Platform navigation/data is disclosed.
CROSS_SCOPE_EVENT="$(jq -cn --argjson identity "$TENANT_IDENTITY" \
  --arg origin "$PUBLIC_ORIGIN" \
  '{operation:"console-request",input:{identity:$identity,scope:{tenantId:null,locationId:null},publicOrigin:$origin,request:{mode:"query",query:{view:"platform-tenants"}}}}')"
invoke_live review-context-console-student "$CROSS_SCOPE_EVENT" \
  "$RUNNER_TEMP/tenant-platform-denial.json"
jq -e '.operation == "console-request" and .result.status == "not-found"' \
  "$RUNNER_TEMP/tenant-platform-denial.json" >/dev/null

# Bench requires ai:operate, so the Platform assessment identity exercises it
# inside the synthetic Tenant scope. The Tenant-only identity remains dedicated
# to proving tenant grant shape and Platform-scope denial above.
BENCH_FORM_EVENT="$(jq -cn --argjson identity "$PLATFORM_IDENTITY" \
  --arg tenantId "$TENANT_ID" --arg locationId "$LOCATION_ID" \
  --arg origin "$PUBLIC_ORIGIN" \
  '{operation:"console-request",input:{identity:$identity,scope:{tenantId:$tenantId,locationId:$locationId},publicOrigin:$origin,request:{mode:"query",query:{view:"bench-form",replayGenerationId:null}}}}')"
invoke_live review-context-console-student "$BENCH_FORM_EVENT" \
  "$RUNNER_TEMP/bench-form.json"
jq -e '
  .result.status == "view" and
  .result.view.view == "bench-form" and
  any(.result.view.data.actions[]; .key == "generate") and
  any(.result.view.data.providers[]; .key == "fake" and .isTestProvider) and
  (.result.view.data.keywords | length) > 0
' "$RUNNER_TEMP/bench-form.json" >/dev/null

BENCH_INPUT="$(jq -c '
  .result.view.data as $form |
  {
    action:"generate",
    styleId:($form.styles | map(select(any(.supportedActions[]; . == "generate")))[0].id),
    promptVersionId:($form.promptVersions | map(select(.action == "generate"))[0].id),
    provider:"fake",
    keywordIds:[$form.keywords[0].id,$form.keywords[1].id],
    freeText:"",
    sourceText:"",
    rating:5
  }
' "$RUNNER_TEMP/bench-form.json")"
AUTHORIZE_BENCH_EVENT="$(jq -cn \
  --argjson identity "$PLATFORM_IDENTITY" \
  --arg tenantId "$TENANT_ID" \
  --arg locationId "$LOCATION_ID" \
  --argjson benchInput "$BENCH_INPUT" \
  '{operation:"authorize-console-bench",input:{identity:$identity,scope:{tenantId:$tenantId,locationId:$locationId},input:$benchInput}}')"
invoke_live review-context-console-student "$AUTHORIZE_BENCH_EVENT" \
  "$RUNNER_TEMP/bench-authorization.json"
jq -e '.operation == "authorize-console-bench" and .result.status == "authorized"' \
  "$RUNNER_TEMP/bench-authorization.json" >/dev/null

BENCH_GENERATIONS_BEFORE="$(psql "$DATABASE_URL" -X -q -A -t -v ON_ERROR_STOP=1 \
  -c "SELECT count(*) FROM generations")"
BENCH_ATTEMPTS_BEFORE="$(psql "$DATABASE_URL" -X -q -A -t -v ON_ERROR_STOP=1 \
  -c "SELECT count(*) FROM provider_attempts")"
BENCH_EVENT="$(jq -c \
  '{operation:"console-bench",input:{receipt:.result.receipt,workload:.result.workload}}' \
  "$RUNNER_TEMP/bench-authorization.json")"
invoke_live review-generation-service-student "$BENCH_EVENT" \
  "$RUNNER_TEMP/bench-result.json"
jq -e '
  .operation == "console-bench" and
  .result.status == "completed" and
  .result.result.isBench == true and
  .result.result.provider == "fake" and
  .result.result.estimatedCost.amountMicros == 0
' "$RUNNER_TEMP/bench-result.json" >/dev/null
BENCH_GENERATIONS_AFTER="$(psql "$DATABASE_URL" -X -q -A -t -v ON_ERROR_STOP=1 \
  -c "SELECT count(*) FROM generations")"
BENCH_ATTEMPTS_AFTER="$(psql "$DATABASE_URL" -X -q -A -t -v ON_ERROR_STOP=1 \
  -c "SELECT count(*) FROM provider_attempts")"
test "$BENCH_GENERATIONS_BEFORE" = "$BENCH_GENERATIONS_AFTER"
test "$BENCH_ATTEMPTS_BEFORE" = "$BENCH_ATTEMPTS_AFTER"

# Exercise the real CloudFront → BFF → Context → Generation composition with
# only committed synthetic fixture data. Browser capability cookies remain in
# RUNNER_TEMP and are never copied into release evidence.
ENTRY_HEADERS="$RUNNER_TEMP/reviewer-entry.headers"
ENTRY_STATUS="$(curl -sS -D "$ENTRY_HEADERS" -c "$COOKIE_JAR" -o /dev/null \
  -w '%{http_code}' "$PUBLIC_ORIGIN/s/speicher-neun/hafencity")"
test "$ENTRY_STATUS" = "303"
ENTRY_PATH="$(awk 'tolower($1) == "location:" {gsub("\\r", "", $2); print $2}' \
  "$ENTRY_HEADERS" | tail -n 1)"
ENTRY_HANDLE="${ENTRY_PATH##*/}"
test -n "$ENTRY_HANDLE"

curl -sS --fail -b "$COOKIE_JAR" \
  "$PUBLIC_ORIGIN/api/v1/entry-challenges/$ENTRY_HANDLE" \
  > "$RUNNER_TEMP/entry-challenge.json"
CSRF_TOKEN="$(jq -er .csrfToken "$RUNNER_TEMP/entry-challenge.json")"
START_BODY="$(jq -cn --arg csrfToken "$CSRF_TOKEN" \
  '{rating:5,action:"generate",csrfToken:$csrfToken}')"
START_HASH="$(printf '%s' "$START_BODY" | sha256sum | cut -d ' ' -f 1)"
START_HEADERS="$RUNNER_TEMP/reviewer-start.headers"
START_STATUS="$(curl -sS -D "$START_HEADERS" -b "$COOKIE_JAR" -o /dev/null \
  -w '%{http_code}' -X POST \
  -H "Origin: $PUBLIC_ORIGIN" \
  -H 'Content-Type: application/json' \
  -H "x-amz-content-sha256: $START_HASH" \
  --data-binary "$START_BODY" \
  "$PUBLIC_ORIGIN/api/v1/entry-challenges/$ENTRY_HANDLE/start")"
test "$START_STATUS" = "303"
REVIEW_PATH="$(awk 'tolower($1) == "location:" {gsub("\\r", "", $2); print $2}' \
  "$START_HEADERS" | tail -n 1)"
REVIEW_SESSION_HANDLE="${REVIEW_PATH##*/}"
test -n "$REVIEW_SESSION_HANDLE"

curl -sS --fail -b "$COOKIE_JAR" \
  "$PUBLIC_ORIGIN/api/v1/review-sessions/$REVIEW_SESSION_HANDLE" \
  > "$RUNNER_TEMP/review-session.json"
FACT_OPTION_IDS="$(jq -cer '[.factOptions[0].id,.factOptions[1].id]' \
  "$RUNNER_TEMP/review-session.json")"
REVIEW_FORMAT_ID="$(jq -er '.reviewFormats[0].id' "$RUNNER_TEMP/review-session.json")"
GENERATION_BODY="$(jq -cn \
  --argjson factOptionIds "$FACT_OPTION_IDS" \
  --arg reviewFormatId "$REVIEW_FORMAT_ID" \
  '{factOptionIds:$factOptionIds,reviewFormatId:$reviewFormatId}')"
GENERATION_HASH="$(printf '%s' "$GENERATION_BODY" | sha256sum | cut -d ' ' -f 1)"
IDEMPOTENCY_KEY="assessment-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"
curl -sS --fail-with-body --no-buffer --max-time 90 \
  -b "$COOKIE_JAR" \
  -X POST \
  -H "Origin: $PUBLIC_ORIGIN" \
  -H 'Accept: text/event-stream' \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $IDEMPOTENCY_KEY" \
  -H "x-amz-content-sha256: $GENERATION_HASH" \
  --data-binary "$GENERATION_BODY" \
  "$PUBLIC_ORIGIN/api/v1/review-sessions/$REVIEW_SESSION_HANDLE/generations" \
  > "$RUNNER_TEMP/reviewer-generation.sse"
grep -F '"type":"terminal"' "$RUNNER_TEMP/reviewer-generation.sse" >/dev/null
grep -F '"status":"completed"' "$RUNNER_TEMP/reviewer-generation.sse" >/dev/null

DEPLOYED_RELEASE_SHA="$(curl -sS --fail "$PUBLIC_ORIGIN/release.json" | jq -er .releaseSha)"
test "$DEPLOYED_RELEASE_SHA" = "$EXPECTED_RELEASE_SHA"

jq -n \
  --arg releaseSha "$DEPLOYED_RELEASE_SHA" \
  '{
    releaseSha:$releaseSha,
    platformIdentityAuthorized:true,
    tenantIdentityAuthorized:true,
    tenantPlatformScopeHidden:true,
    bench:{completed:true,provider:"fake",costMicros:0,persistedRows:0},
    reviewerGenerationCompleted:true
  }' > "$EVIDENCE_DIR/post-deploy-assessment.json"
echo "Post-deploy assessment evidence passed."
