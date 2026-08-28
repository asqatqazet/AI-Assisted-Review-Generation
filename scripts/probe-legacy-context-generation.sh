#!/usr/bin/env bash
set -euo pipefail

: "${LEGACY_CONTEXT_VERSION_ARN:?LEGACY_CONTEXT_VERSION_ARN is required}"
: "${PROBE_PHASE:?PROBE_PHASE is required}"
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"

if [[ ! "$LEGACY_CONTEXT_VERSION_ARN" =~ :[1-9][0-9]*$ ]]; then
  printf '%s\n' "LEGACY_CONTEXT_VERSION_ARN_MUST_BE_IMMUTABLE" >&2
  exit 1
fi
if [[ ! "$PROBE_PHASE" =~ ^[a-z0-9-]+$ ]]; then
  printf '%s\n' "LEGACY_CONTEXT_PROBE_PHASE_INVALID" >&2
  exit 1
fi

readonly BROWSER_CAPABILITY="legacy_${GITHUB_RUN_ID:-local}_${GITHUB_RUN_ATTEMPT:-1}"
readonly IDEMPOTENCY_KEY="legacy-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"

invoke_legacy() {
  local payload="$1"
  local output_file="$2"
  local metadata
  metadata="$(
    aws lambda invoke \
      --function-name "$LEGACY_CONTEXT_VERSION_ARN" \
      --cli-binary-format raw-in-base64-out \
      --payload "$payload" \
      "$output_file"
  )"
  if [ "$(jq -r '.FunctionError // empty' <<< "$metadata")" != "" ]; then
    printf '%s\n' "LEGACY_CONTEXT_INVOCATION_FAILED:${PROBE_PHASE}" >&2
    return 1
  fi
}

assert_response() {
  local response_file="$1"
  local label="$2"
  local predicate="$3"
  if ! jq -e "$predicate" "$response_file" >/dev/null; then
    jq -c '{operation,result:{status:.result.status,code:.result.code,retryable:.result.retryable,retryAfterSeconds:.result.retryAfterSeconds}}' \
      "$response_file" >&2 || true
    printf '%s\n' "LEGACY_CONTEXT_PROBE_ASSERTION_FAILED:${PROBE_PHASE}:${label}" >&2
    return 1
  fi
}

if [ "$PROBE_PHASE" = "after-migration" ]; then
  BEFORE_ADVANCE="$RUNNER_TEMP/legacy-before-migration-advance.json"
  test -s "$BEFORE_ADVANCE"
  REVIEW_HANDLE="$(jq -er '.result.reviewSessionHandle' "$BEFORE_ADVANCE")"
else
  PREPARE_EVENT="$(jq -cn --arg browser "$BROWSER_CAPABILITY" \
    '{operation:"prepare-entry",input:{tenantSlug:"speicher-neun",locationSlug:"hafencity",browserCapability:$browser}}')"
  invoke_legacy "$PREPARE_EVENT" "$RUNNER_TEMP/legacy-${PROBE_PHASE}-prepare.json"
  assert_response "$RUNNER_TEMP/legacy-${PROBE_PHASE}-prepare.json" prepare \
    '.operation == "prepare-entry" and .result.status == "prepared"'
  ENTRY_HANDLE="$(jq -er '.result.entryChallengeHandle' \
    "$RUNNER_TEMP/legacy-${PROBE_PHASE}-prepare.json")"

  ADVANCE_EVENT="$(jq -cn \
    --arg entryChallengeHandle "$ENTRY_HANDLE" \
    --arg browser "$BROWSER_CAPABILITY" \
    '{operation:"advance-entry",input:{entryChallengeHandle:$entryChallengeHandle,browserCapability:$browser,rating:5,action:"generate"}}')"
  invoke_legacy "$ADVANCE_EVENT" "$RUNNER_TEMP/legacy-${PROBE_PHASE}-advance.json"
  assert_response "$RUNNER_TEMP/legacy-${PROBE_PHASE}-advance.json" advance \
    '.operation == "advance-entry" and .result.status == "admitted"'
  REVIEW_HANDLE="$(jq -er '.result.reviewSessionHandle' \
    "$RUNNER_TEMP/legacy-${PROBE_PHASE}-advance.json")"
fi

READ_EVENT="$(jq -cn \
  --arg reviewSessionHandle "$REVIEW_HANDLE" \
  --arg browser "$BROWSER_CAPABILITY" \
  '{operation:"read-review-session",input:{reviewSessionHandle:$reviewSessionHandle,browserCapability:$browser}}')"
invoke_legacy "$READ_EVENT" "$RUNNER_TEMP/legacy-${PROBE_PHASE}-session.json"
assert_response "$RUNNER_TEMP/legacy-${PROBE_PHASE}-session.json" session '
  .operation == "read-review-session" and
  .result.status == "ready" and
  (.result.factOptions | length) > 0 and
  (.result.reviewFormats | length) > 0
'
MINIMUM_FACT_SELECTIONS="$(jq -er \
  '.result.requirements.minimumFactSelections |
   select(type == "number" and floor == . and . >= 1)' \
  "$RUNNER_TEMP/legacy-${PROBE_PHASE}-session.json")"
FACT_OPTION_IDS="$(jq -ce --argjson minimum "$MINIMUM_FACT_SELECTIONS" \
  '.result.factOptions[0:$minimum] | map(.id) |
   select(length == $minimum)' \
  "$RUNNER_TEMP/legacy-${PROBE_PHASE}-session.json")"
REVIEW_FORMAT_ID="$(jq -er '.result.reviewFormats[0].id' \
  "$RUNNER_TEMP/legacy-${PROBE_PHASE}-session.json")"

GENERATION_EVENT="$(jq -cn \
  --arg reviewSessionHandle "$REVIEW_HANDLE" \
  --arg browser "$BROWSER_CAPABILITY" \
  --arg idempotencyKey "$IDEMPOTENCY_KEY" \
  --argjson factOptionIds "$FACT_OPTION_IDS" \
  --arg reviewFormatId "$REVIEW_FORMAT_ID" \
  '{operation:"prepare-reviewer-generation",input:{reviewSessionHandle:$reviewSessionHandle,browserCapability:$browser,idempotencyKey:$idempotencyKey,command:{factOptionIds:$factOptionIds,reviewFormatId:$reviewFormatId}}}')"
invoke_legacy "$GENERATION_EVENT" \
  "$RUNNER_TEMP/legacy-${PROBE_PHASE}-generation.json"
assert_response "$RUNNER_TEMP/legacy-${PROBE_PHASE}-generation.json" generation '
  .operation == "prepare-reviewer-generation" and
  .result.status == "prepared" and
  (.result.workload.bindings.snapshotId | type == "string") and
  (.result.workload.bindings.snapshotId | length) > 0 and
  .result.workload.bindings.snapshotId == .result.workload.snapshot.snapshotId and
  .result.workload.command.kind == "generate" and
  (.result.workload.assertions | length) > 0
'

if [ "$PROBE_PHASE" = "after-migration" ]; then
  BEFORE_GENERATION="$RUNNER_TEMP/legacy-before-migration-generation.json"
  test -s "$BEFORE_GENERATION"
  if ! jq -e --slurpfile before "$BEFORE_GENERATION" \
    '.result.workload == $before[0].result.workload' \
    "$RUNNER_TEMP/legacy-${PROBE_PHASE}-generation.json" >/dev/null; then
    printf '%s\n' "LEGACY_CONTEXT_WORKLOAD_CHANGED_AFTER_EXPANSION" >&2
    exit 1
  fi
fi

printf '%s\n' "Legacy immutable Context Prompt/Generation probe passed: ${PROBE_PHASE}."
