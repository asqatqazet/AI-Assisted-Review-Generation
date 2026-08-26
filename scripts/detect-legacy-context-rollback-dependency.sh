#!/usr/bin/env bash
set -euo pipefail

: "${ACKNOWLEDGE_DATABASE_CUTOVER:?ACKNOWLEDGE_DATABASE_CUTOVER is required}"
: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"

if [[ "$ACKNOWLEDGE_DATABASE_CUTOVER" != "true" && "$ACKNOWLEDGE_DATABASE_CUTOVER" != "false" ]]; then
  printf '%s\n' "ACKNOWLEDGE_DATABASE_CUTOVER_INVALID" >&2
  exit 1
fi

readonly LEGACY_CONTEXT_FUNCTION="review-context-service-student"
readonly BFF_FUNCTIONS=(
  "review-web-bff-fast-student"
  "review-web-bff-stream-student"
  "review-web-bff-reconcile-student"
)

legacy_required=false
error_file="$(mktemp)"
cleanup() { rm -f "$error_file"; }
trap cleanup EXIT

for function_name in "${BFF_FUNCTIONS[@]}"; do
  if configuration="$(aws lambda get-function-configuration \
    --function-name "$function_name" \
    --qualifier live \
    --output json 2>"$error_file")"; then
    if jq -e --arg legacy "$LEGACY_CONTEXT_FUNCTION" '
      (.Environment.Variables // {})
      | to_entries
      | any(
          .[];
          (.value |
            type == "string" and
            test(":function:" + $legacy + "(?::[^:]+)?$"))
        )
    ' <<< "$configuration" >/dev/null; then
      legacy_required=true
    fi
  elif grep -Eq 'ResourceNotFoundException|ResourceNotFound' "$error_file"; then
    : # A fresh stack has no rollback dependency.
  else
    cat "$error_file" >&2
    exit 1
  fi
  : > "$error_file"
done

if [[ "$legacy_required" == "true" && "$ACKNOWLEDGE_DATABASE_CUTOVER" == "true" ]]; then
  printf '%s\n' "required=false" "cutover=true" >> "$GITHUB_OUTPUT"
elif [[ "$legacy_required" == "true" ]]; then
  printf '%s\n' "required=true" "cutover=false" >> "$GITHUB_OUTPUT"
else
  printf '%s\n' "required=false" "cutover=false" >> "$GITHUB_OUTPUT"
fi
