#!/usr/bin/env bash
set -Eeuo pipefail

: "${RUNNER_TEMP:?RUNNER_TEMP is required}"
: "${RELEASE_DIR:?RELEASE_DIR is required}"
: "${CANDIDATE_ID:?CANDIDATE_ID is required}"
: "${UI_BUCKET:?UI_BUCKET is required}"
: "${EXPECTED_RELEASE_SHA:?EXPECTED_RELEASE_SHA is required}"
: "${CONFIGURATION_CANDIDATE_RELEASE_ID:?CONFIGURATION_CANDIDATE_RELEASE_ID is required}"
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${PUBLIC_ORIGIN:?PUBLIC_ORIGIN is required}"

readonly CANDIDATE_ORIGIN="$PUBLIC_ORIGIN"
readonly EVIDENCE_DIR="${RELEASE_DIR}/evidence"
readonly IDEMPOTENCY_KEY="candidate-bff-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"
mkdir -p "$EVIDENCE_DIR"

SMOKE_STAGE="initialization"
trap 'printf "%s\n" "CANDIDATE_REVIEWER_SMOKE_FAILED:${SMOKE_STAGE}" >&2' ERR

invoke_buffered() {
  local function_name="$1"
  local payload="$2"
  local output_file="$3"
  local metadata
  metadata="$(
    aws lambda invoke \
      --function-name "$function_name" \
      --qualifier candidate \
      --cli-binary-format raw-in-base64-out \
      --payload "$payload" \
      "$output_file"
  )"
  if [ "$(jq -r '.FunctionError // empty' <<< "$metadata")" != "" ]; then
    printf '%s\n' "CANDIDATE_BFF_INVOCATION_FAILED:${function_name}" >&2
    return 1
  fi
}

invoke_stream() {
  local function_name="$1"
  local payload="$2"
  local output_file="$3"
  local payload_file="${output_file}.request.json"
  printf '%s' "$payload" > "$payload_file"
  if ! pnpm --dir apps/web-bff exec tsx scripts/invoke-with-response-stream.ts \
    "$function_name" "$payload_file" "$output_file"; then
    printf '%s\n' "CANDIDATE_BFF_STREAM_FAILED:${function_name}" >&2
    return 1
  fi
}

http_event() {
  local method="$1"
  local path="$2"
  local body="$3"
  local cookies_json="$4"
  local headers_json="$5"
  jq -cn \
    --arg method "$method" \
    --arg path "$path" \
    --arg body "$body" \
    --arg publicOrigin "$CANDIDATE_ORIGIN" \
    --argjson cookies "$cookies_json" \
    --argjson extraHeaders "$headers_json" \
    '{
      version:"2.0",
      routeKey:($method + " " + $path),
      rawPath:$path,
      rawQueryString:"",
      headers:({host:"candidate.internal","x-forwarded-for":"127.0.0.1","x-review-public-origin":$publicOrigin} + $extraHeaders),
      cookies:$cookies,
      requestContext:{
        accountId:"candidate",
        apiId:"candidate",
        domainName:"candidate.internal",
        domainPrefix:"candidate",
        http:{method:$method,path:$path,protocol:"HTTP/1.1",sourceIp:"127.0.0.1",userAgent:"candidate-ui-bff-smoke"},
        requestId:"candidate-ui-bff-smoke",
        routeKey:($method + " " + $path),
        stage:"$default",
        time:"24/Aug/2026:00:00:00 +0000",
        timeEpoch:0
      },
      body:(if $body == "" then null else $body end),
      isBase64Encoded:false
    }'
}

response_body() {
  local response_file="$1"
  local output_file="$2"
  if [ "$(jq -r '.isBase64Encoded // false' "$response_file")" = "true" ]; then
    jq -er .body "$response_file" | base64 --decode > "$output_file"
  else
    jq -er .body "$response_file" > "$output_file"
  fi
}

candidate_cookies() {
  local response_file="$1"
  jq -c '[.cookies[]? | split(";")[0]]' "$response_file"
}

# The staged UI and the BFF candidate must describe the same immutable release.
SMOKE_STAGE="staged-ui"
test "$(aws s3 cp "s3://${UI_BUCKET}/__candidate/${CANDIDATE_ID}/release.json" - | jq -er .releaseSha)" = "$EXPECTED_RELEASE_SHA"
aws s3 cp "s3://${UI_BUCKET}/__candidate/${CANDIDATE_ID}/index.html" \
  "$RUNNER_TEMP/candidate-index.html" >/dev/null
test -s "$RUNNER_TEMP/candidate-index.html"

# All three BFF handlers are one release and must carry the same exact service
# version pins plus the staged configuration release id.
SMOKE_STAGE="service-pins"
EXPECTED_PINS=""
for function_name in \
  review-web-bff-fast-student \
  review-web-bff-stream-student \
  review-web-bff-reconcile-student; do
  CONFIGURATION="$(aws lambda get-function-configuration \
    --function-name "$function_name" \
    --qualifier candidate \
    --output json)"
  test "$(jq -r '.Environment.Variables.REVIEW_CONFIGURATION_RELEASE_ID' <<< "$CONFIGURATION")" = \
    "$CONFIGURATION_CANDIDATE_RELEASE_ID"
  PINS="$(jq -c '[
    .Environment.Variables.CONTEXT_REVIEWER_FUNCTION_ALIAS_ARN,
    .Environment.Variables.CONTEXT_CONSOLE_FUNCTION_ALIAS_ARN,
    .Environment.Variables.GENERATION_FUNCTION_ALIAS_ARN,
    .Environment.Variables.GENERATION_CANDIDATE_FUNCTION_ALIAS_ARN
  ] | sort' <<< "$CONFIGURATION")"
  jq -e 'all(.[]; test(":review-(context-reviewer|context-console|generation-(service|canary))-student:[1-9][0-9]*$"))' \
    <<< "$PINS" >/dev/null
  if [ -z "$EXPECTED_PINS" ]; then
    EXPECTED_PINS="$PINS"
  else
    test "$PINS" = "$EXPECTED_PINS"
  fi
done

COOKIES='[]'
EMPTY_HEADERS='{}'
SMOKE_STAGE="entry-redirect"
ENTRY_PATH="/s/speicher-neun/hafencity"
ENTRY_EVENT="$(http_event GET "$ENTRY_PATH" "" "$COOKIES" "$EMPTY_HEADERS")"
invoke_buffered "review-web-bff-fast-student" "$ENTRY_EVENT" "$RUNNER_TEMP/candidate-bff-entry.json"
test "$(jq -r .statusCode "$RUNNER_TEMP/candidate-bff-entry.json")" = "303"
COOKIES="$(candidate_cookies "$RUNNER_TEMP/candidate-bff-entry.json")"
ENTRY_LOCATION="$(jq -er '.headers.location // .headers.Location' \
  "$RUNNER_TEMP/candidate-bff-entry.json")"
ENTRY_HANDLE="${ENTRY_LOCATION##*/}"
test -n "$ENTRY_HANDLE"

ENTRY_API_PATH="/api/v1/entry-challenges/${ENTRY_HANDLE}"
SMOKE_STAGE="entry-state"
ENTRY_API_EVENT="$(http_event GET "$ENTRY_API_PATH" "" "$COOKIES" "$EMPTY_HEADERS")"
invoke_buffered "review-web-bff-fast-student" "$ENTRY_API_EVENT" \
  "$RUNNER_TEMP/candidate-bff-entry-state-response.json"
test "$(jq -r .statusCode "$RUNNER_TEMP/candidate-bff-entry-state-response.json")" = "200"
response_body "$RUNNER_TEMP/candidate-bff-entry-state-response.json" \
  "$RUNNER_TEMP/candidate-bff-entry-state.json"
CSRF_TOKEN="$(jq -er .csrfToken "$RUNNER_TEMP/candidate-bff-entry-state.json")"

START_BODY="$(jq -cn --arg csrfToken "$CSRF_TOKEN" \
  '{rating:5,action:"generate",csrfToken:$csrfToken}')"
SMOKE_STAGE="entry-start"
START_HASH="$(printf '%s' "$START_BODY" | sha256sum | cut -d ' ' -f 1)"
START_HEADERS="$(jq -cn --arg origin "$CANDIDATE_ORIGIN" --arg hash "$START_HASH" \
  '{origin:$origin,"content-type":"application/json","x-amz-content-sha256":$hash}')"
START_PATH="${ENTRY_API_PATH}/start"
START_EVENT="$(http_event POST "$START_PATH" "$START_BODY" "$COOKIES" "$START_HEADERS")"
invoke_buffered "review-web-bff-fast-student" "$START_EVENT" "$RUNNER_TEMP/candidate-bff-start.json"
test "$(jq -r .statusCode "$RUNNER_TEMP/candidate-bff-start.json")" = "303"
COOKIES="$(jq -cn \
  --argjson previous "$COOKIES" \
  --argjson current "$(candidate_cookies "$RUNNER_TEMP/candidate-bff-start.json")" \
  '$previous + $current')"
REVIEW_LOCATION="$(jq -er '.headers.location // .headers.Location' \
  "$RUNNER_TEMP/candidate-bff-start.json")"
REVIEW_HANDLE="${REVIEW_LOCATION##*/}"
test -n "$REVIEW_HANDLE"

REVIEW_PATH="/api/v1/review-sessions/${REVIEW_HANDLE}"
SMOKE_STAGE="review-state"
REVIEW_EVENT="$(http_event GET "$REVIEW_PATH" "" "$COOKIES" "$EMPTY_HEADERS")"
invoke_buffered "review-web-bff-fast-student" "$REVIEW_EVENT" \
  "$RUNNER_TEMP/candidate-bff-review-response.json"
test "$(jq -r .statusCode "$RUNNER_TEMP/candidate-bff-review-response.json")" = "200"
response_body "$RUNNER_TEMP/candidate-bff-review-response.json" \
  "$RUNNER_TEMP/candidate-bff-review.json"
FACT_OPTION_ID="$(jq -er '.factOptions[0].id' "$RUNNER_TEMP/candidate-bff-review.json")"
REVIEW_FORMAT_ID="$(jq -er '.reviewFormats[0].id' "$RUNNER_TEMP/candidate-bff-review.json")"

GENERATION_BODY="$(jq -cn \
  --arg factOptionId "$FACT_OPTION_ID" \
  --arg reviewFormatId "$REVIEW_FORMAT_ID" \
  '{factOptionIds:[$factOptionId],reviewFormatId:$reviewFormatId}')"
SMOKE_STAGE="generation-stream"
GENERATION_HASH="$(printf '%s' "$GENERATION_BODY" | sha256sum | cut -d ' ' -f 1)"
GENERATION_HEADERS="$(jq -cn \
  --arg origin "$CANDIDATE_ORIGIN" \
  --arg hash "$GENERATION_HASH" \
  --arg idempotencyKey "$IDEMPOTENCY_KEY" \
  '{origin:$origin,accept:"text/event-stream","content-type":"application/json","x-amz-content-sha256":$hash,"idempotency-key":$idempotencyKey}')"
GENERATION_PATH="${REVIEW_PATH}/generations"
GENERATION_EVENT="$(http_event POST "$GENERATION_PATH" "$GENERATION_BODY" "$COOKIES" "$GENERATION_HEADERS")"
invoke_stream "review-web-bff-stream-student" "$GENERATION_EVENT" \
  "$RUNNER_TEMP/candidate-bff-generation.sse"
SMOKE_STAGE="generation-terminal"
if ! grep -aF '"type":"terminal"' "$RUNNER_TEMP/candidate-bff-generation.sse" >/dev/null; then
  printf '%s\n' "CANDIDATE_REVIEWER_TERMINAL:missing:none" >&2
  false
fi
SMOKE_STAGE="generation-completed"
if ! grep -aF '"status":"completed"' "$RUNNER_TEMP/candidate-bff-generation.sse" >/dev/null; then
  TERMINAL_STATUS="$(grep -aoE '"status":"[a-z-]+"' \
    "$RUNNER_TEMP/candidate-bff-generation.sse" | tail -n 1 | cut -d '"' -f 4 || true)"
  TERMINAL_CODE="$(grep -aoE '"code":"[A-Z0-9_]+"' \
    "$RUNNER_TEMP/candidate-bff-generation.sse" | tail -n 1 | cut -d '"' -f 4 || true)"
  printf '%s\n' "CANDIDATE_REVIEWER_TERMINAL:${TERMINAL_STATUS:-unknown}:${TERMINAL_CODE:-none}" >&2
  false
fi

# Public responses intentionally omit internal provenance. Verify the exact
# session and completed Generation through the deployment-owner connection.
SMOKE_STAGE="provenance"
REVIEW_HANDLE_HASH="sha256:$(printf '%s' "$REVIEW_HANDLE" | sha256sum | cut -d ' ' -f 1)"
OBSERVED_PROVENANCE="$(
  psql "$DATABASE_URL" -X -q -A -t -v ON_ERROR_STOP=1 \
    -v route_handle_hash="$REVIEW_HANDLE_HASH" \
    -v idempotency_key="$IDEMPOTENCY_KEY" <<'SQL'
SELECT
  member.release_id::text || '|' ||
  session.configuration_snapshot_id::text || '|' ||
  generation.prompt_version_id::text
FROM public.review_session_browser_bindings AS binding
JOIN public.review_sessions AS session
  ON session.id = binding.review_session_id
 AND session.tenant_id = binding.tenant_id
 AND session.location_id = binding.location_id
JOIN public.configuration_release_snapshots AS member
  ON member.tenant_id = session.tenant_id
 AND member.location_id = session.location_id
 AND member.snapshot_id = session.configuration_snapshot_id
JOIN public.generation_batches AS batch
  ON batch.tenant_id = session.tenant_id
 AND batch.location_id = session.location_id
 AND batch.review_session_id = session.id
 AND batch.idempotency_key = :'idempotency_key'
JOIN public.generations AS generation
  ON generation.tenant_id = batch.tenant_id
 AND generation.location_id = batch.location_id
 AND generation.review_session_id = batch.review_session_id
 AND generation.generation_batch_id = batch.id
WHERE binding.route_handle_hash = :'route_handle_hash'
  AND generation.status = 'COMPLETED'
ORDER BY generation.created_at DESC, generation.id DESC
LIMIT 1;
SQL
)"
IFS='|' read -r OBSERVED_CONFIGURATION_RELEASE_ID \
  OBSERVED_CONFIGURATION_SNAPSHOT_ID OBSERVED_PROMPT_VERSION_ID \
  <<< "$OBSERVED_PROVENANCE"
test "$OBSERVED_CONFIGURATION_RELEASE_ID" = "$CONFIGURATION_CANDIDATE_RELEASE_ID"
[[ "$OBSERVED_CONFIGURATION_SNAPSHOT_ID" =~ ^[0-9a-f-]{36}$ ]]
[[ "$OBSERVED_PROMPT_VERSION_ID" =~ ^[0-9a-f-]{36}$ ]]

SMOKE_STAGE="evidence"
jq -n \
  --arg configurationReleaseId "$OBSERVED_CONFIGURATION_RELEASE_ID" \
  --arg configurationSnapshotId "$OBSERVED_CONFIGURATION_SNAPSHOT_ID" \
  --arg promptVersionId "$OBSERVED_PROMPT_VERSION_ID" \
  --argjson serviceVersionArns "$EXPECTED_PINS" \
  '{candidateBffReviewerGenerationCompleted:true,provider:"fake",costMicros:0,configurationReleaseId:$configurationReleaseId,configurationSnapshotId:$configurationSnapshotId,promptVersionId:$promptVersionId,serviceVersionArns:$serviceVersionArns}' \
  > "$EVIDENCE_DIR/candidate-reviewer-generation.json"

trap - ERR
printf '%s\n' "Candidate UI/BFF reviewer Generation smoke passed."
