#!/usr/bin/env bash

set -euo pipefail

: "${GENERATION_CONCURRENCY_SNAPSHOT:?GENERATION_CONCURRENCY_SNAPSHOT is required}"
: "${GENERATION_FUNCTION_NAME:?GENERATION_FUNCTION_NAME is required}"

if [ ! -f "$GENERATION_CONCURRENCY_SNAPSHOT" ]; then
  printf '%s\n' "GENERATION_CONCURRENCY_SNAPSHOT_MISSING" >&2
  exit 1
fi

FUNCTION_EXISTED="$(jq -r '.functionExisted' "$GENERATION_CONCURRENCY_SNAPSHOT")"
if [ "$FUNCTION_EXISTED" = "false" ]; then
  exit 0
fi
if [ "$FUNCTION_EXISTED" != "true" ]; then
  printf '%s\n' "GENERATION_CONCURRENCY_SNAPSHOT_INVALID" >&2
  exit 1
fi

PREVIOUS_PROVIDER_MODE="$(jq -r '.providerMode // "unknown"' "$GENERATION_CONCURRENCY_SNAPSHOT")"
PREVIOUS_CONCURRENCY="$(jq -r '.reservedConcurrentExecutions // "none"' "$GENERATION_CONCURRENCY_SNAPSHOT")"

if [ "$PREVIOUS_PROVIDER_MODE" != "fake-only" ]; then
  # A failed paid-to-free transition must stay closed. Restoring the former
  # concurrency here would make the old paid version billable again.
  aws lambda put-function-concurrency \
    --function-name "$GENERATION_FUNCTION_NAME" \
    --reserved-concurrent-executions 0 >/dev/null
  exit 0
fi

if [ "$PREVIOUS_CONCURRENCY" = "none" ]; then
  aws lambda delete-function-concurrency \
    --function-name "$GENERATION_FUNCTION_NAME" >/dev/null
elif [[ "$PREVIOUS_CONCURRENCY" =~ ^[0-9]+$ ]]; then
  aws lambda put-function-concurrency \
    --function-name "$GENERATION_FUNCTION_NAME" \
    --reserved-concurrent-executions "$PREVIOUS_CONCURRENCY" >/dev/null
else
  printf '%s\n' "GENERATION_CONCURRENCY_SNAPSHOT_INVALID" >&2
  exit 1
fi
