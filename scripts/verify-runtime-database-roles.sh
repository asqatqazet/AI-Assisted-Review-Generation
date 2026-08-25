#!/usr/bin/env bash
set -euo pipefail

: "${CONTEXT_RUNTIME_DATABASE_URL:?CONTEXT_RUNTIME_DATABASE_URL is required}"
: "${CONSOLE_CONTROL_DATABASE_URL:?CONSOLE_CONTROL_DATABASE_URL is required}"
: "${GENERATION_DATABASE_URL:?GENERATION_DATABASE_URL is required}"

readonly ROLE_CONTRACT_SQL="
SELECT CASE WHEN
  current_user = '__EXPECTED_ROLE__'
  AND EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = current_user
      AND rolcanlogin
      AND NOT rolsuper
      AND NOT rolbypassrls
      AND NOT rolinherit
  )
  AND has_schema_privilege(current_user, 'public', 'USAGE')
  AND CASE '__EXPECTED_ROLE__'
    WHEN 'context_runtime_svc' THEN
      has_table_privilege(current_user, 'public.tenants', 'SELECT')
      AND has_table_privilege(current_user, 'public.effective_configuration_snapshots', 'SELECT')
      AND has_table_privilege(current_user, 'public.review_sessions', 'SELECT,INSERT,UPDATE')
      AND has_table_privilege(current_user, 'public.review_session_browser_bindings', 'SELECT,INSERT,UPDATE')
      AND NOT has_table_privilege(current_user, 'public.operators', 'SELECT')
      AND NOT has_table_privilege(current_user, 'public.tenant_access_grants', 'SELECT')
      AND NOT has_table_privilege(current_user, 'public.platform_access_grants', 'SELECT')
      AND NOT has_table_privilege(current_user, 'public.generations', 'SELECT')
      AND NOT has_table_privilege(current_user, 'public.effective_configuration_snapshots', 'INSERT,UPDATE,DELETE')
    WHEN 'console_control_svc' THEN
      has_table_privilege(current_user, 'public.operator_role_definitions', 'SELECT')
      AND has_table_privilege(current_user, 'public.tenant_access_grants', 'SELECT,INSERT,UPDATE')
      AND has_table_privilege(current_user, 'public.platform_access_grants', 'SELECT,INSERT,UPDATE')
      AND has_table_privilege(current_user, 'public.configuration_drafts', 'SELECT,INSERT,UPDATE,DELETE')
      AND has_function_privilege(current_user, 'public.console_resolve_operator_identity(text,text,text,bigint,uuid,text)', 'EXECUTE')
      AND has_function_privilege(current_user, 'public.console_bind_operator_authorization(uuid,bigint,uuid,text)', 'EXECUTE')
      AND NOT has_table_privilege(current_user, 'public.operators', 'SELECT,INSERT,UPDATE,DELETE')
      AND NOT has_table_privilege(current_user, 'public.console_database_authority_keys', 'SELECT,INSERT,UPDATE,DELETE')
      AND NOT has_table_privilege(current_user, 'public.generations', 'SELECT')
      AND NOT has_table_privilege(current_user, 'public.claims', 'SELECT')
      AND NOT has_table_privilege(current_user, 'public.review_session_browser_bindings', 'SELECT')
      AND NOT has_table_privilege(current_user, 'public.review_sessions', 'INSERT,UPDATE,DELETE')
    WHEN 'generation_svc' THEN
      has_table_privilege(current_user, 'public.generations', 'SELECT,INSERT,UPDATE')
      AND has_table_privilege(current_user, 'public.provider_attempts', 'SELECT,INSERT,UPDATE')
      AND has_table_privilege(current_user, 'public.claims', 'SELECT,INSERT,UPDATE')
      AND has_table_privilege(current_user, 'public.execution_leases', 'SELECT,INSERT,UPDATE')
      AND NOT has_table_privilege(current_user, 'public.tenants', 'SELECT')
      AND NOT has_table_privilege(current_user, 'public.operators', 'SELECT')
      AND NOT has_table_privilege(current_user, 'public.tenant_access_grants', 'SELECT')
      AND NOT has_table_privilege(current_user, 'public.platform_access_grants', 'SELECT')
      AND NOT has_table_privilege(current_user, 'public.effective_configuration_snapshots', 'SELECT')
      AND NOT has_table_privilege(current_user, 'public.configuration_drafts', 'SELECT,INSERT,UPDATE,DELETE')
    ELSE false
  END
THEN 'ok' ELSE 'invalid' END;
"

verify_connection() {
  local database_url="$1"
  local expected_role="$2"
  local role_contract_sql
  local result

  case "$expected_role" in
    context_runtime_svc|console_control_svc|generation_svc) ;;
    *)
      echo "::error::Unexpected runtime database role contract." >&2
      return 1
      ;;
  esac
  role_contract_sql="${ROLE_CONTRACT_SQL//__EXPECTED_ROLE__/$expected_role}"

  if ! result="$(
    psql "$database_url" \
      -X -q -A -t \
      -v ON_ERROR_STOP=1 \
      -c "$role_contract_sql"
  )"; then
    echo "::error::Database role verification could not run for ${expected_role}." >&2
    return 1
  fi

  result="${result//$'\r'/}"
  result="${result//$'\n'/}"
  if [ "$result" != "ok" ]; then
    echo "::error::Database connection for ${expected_role} violates the sealed role contract." >&2
    return 1
  fi
}

verify_connection "$CONTEXT_RUNTIME_DATABASE_URL" context_runtime_svc
verify_connection "$CONSOLE_CONTROL_DATABASE_URL" console_control_svc
verify_connection "$GENERATION_DATABASE_URL" generation_svc
echo "Verified three sealed runtime database roles."
