#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${OPERATOR_EMAIL:?OPERATOR_EMAIL is required}"
: "${TENANT_OPERATOR_EMAIL:?TENANT_OPERATOR_EMAIL is required}"
: "${REQUESTED_BOOTSTRAP:?REQUESTED_BOOTSTRAP is required}"
: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"

if [[ ! "$OPERATOR_EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] ||
   [[ ! "$TENANT_OPERATOR_EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]]; then
  echo "::error::OPERATOR_EMAIL_INVALID: both assessment identities are required." >&2
  exit 1
fi
operator_email_normalized="$(printf '%s' "$OPERATOR_EMAIL" | tr '[:upper:]' '[:lower:]')"
tenant_operator_email_normalized="$(printf '%s' "$TENANT_OPERATOR_EMAIL" | tr '[:upper:]' '[:lower:]')"
if [ "$operator_email_normalized" = "$tenant_operator_email_normalized" ]; then
  echo "::error::OPERATOR_IDENTITIES_MUST_BE_DISTINCT." >&2
  exit 1
fi
if [ "$REQUESTED_BOOTSTRAP" != "true" ] && [ "$REQUESTED_BOOTSTRAP" != "false" ]; then
  echo "::error::REQUESTED_BOOTSTRAP must be true or false." >&2
  exit 1
fi

state="$(
  psql "$DATABASE_URL" -X -q -A -t -F '|' -v ON_ERROR_STOP=1 \
    -v operator_email="$OPERATOR_EMAIL" \
    -v tenant_operator_email="$TENANT_OPERATOR_EMAIL" <<'SQL'
      SELECT
        (SELECT count(*) FROM operators),
        (SELECT count(*) FROM platform_access_grants),
        (
          SELECT count(*)
          FROM operators AS operator
          JOIN platform_access_grants AS access_grant
            ON access_grant.operator_id = operator.id
          JOIN operator_role_definitions AS role
            ON role.key = access_grant.role_key
           AND role.status = 'ACTIVE'
           AND 'platform:admin' = ANY(role.capabilities)
          WHERE lower(operator.email) = lower(:'operator_email')
            AND operator.status = 'ACTIVE'
            AND access_grant.status = 'ACTIVE'
            AND access_grant.revoked_at IS NULL
            AND access_grant.valid_from <= clock_timestamp()
            AND (access_grant.valid_until IS NULL OR access_grant.valid_until > clock_timestamp())
        ),
        (
          SELECT count(*)
          FROM operators AS operator
          JOIN tenant_access_grants AS access_grant
            ON access_grant.operator_id = operator.id
           AND access_grant.tenant_id = '00000000-0000-4000-8000-000000000101'
          JOIN operator_role_definitions AS role
            ON role.key = access_grant.role_key
           AND role.status = 'ACTIVE'
           AND 'tenant:configure' = ANY(role.capabilities)
          WHERE lower(operator.email) = lower(:'operator_email')
            AND operator.status = 'ACTIVE'
            AND access_grant.status = 'ACTIVE'
            AND access_grant.revoked_at IS NULL
            AND access_grant.valid_from <= clock_timestamp()
            AND (access_grant.valid_until IS NULL OR access_grant.valid_until > clock_timestamp())
        ),
        (
          SELECT count(*) FROM operators
          WHERE lower(email) = lower(:'tenant_operator_email')
        ),
        (
          SELECT count(*)
          FROM operators AS operator
          JOIN tenant_access_grants AS access_grant
            ON access_grant.operator_id = operator.id
          WHERE lower(operator.email) = lower(:'tenant_operator_email')
            AND operator.status = 'ACTIVE'
            AND access_grant.status = 'ACTIVE'
            AND access_grant.revoked_at IS NULL
            AND access_grant.valid_from <= clock_timestamp()
            AND (access_grant.valid_until IS NULL OR access_grant.valid_until > clock_timestamp())
        ),
        (
          SELECT count(*)
          FROM operators AS operator
          JOIN tenant_access_grants AS access_grant
            ON access_grant.operator_id = operator.id
           AND access_grant.tenant_id = '00000000-0000-4000-8000-000000000101'
          JOIN operator_role_definitions AS role
            ON role.key = access_grant.role_key
           AND role.status = 'ACTIVE'
           AND 'tenant:configure' = ANY(role.capabilities)
          WHERE lower(operator.email) = lower(:'tenant_operator_email')
            AND operator.status = 'ACTIVE'
            AND access_grant.status = 'ACTIVE'
            AND access_grant.revoked_at IS NULL
            AND access_grant.valid_from <= clock_timestamp()
            AND (access_grant.valid_until IS NULL OR access_grant.valid_until > clock_timestamp())
        ),
        (
          SELECT count(*)
          FROM operators AS operator
          JOIN platform_access_grants AS access_grant
            ON access_grant.operator_id = operator.id
          WHERE lower(operator.email) = lower(:'tenant_operator_email')
        );
SQL
)"

IFS='|' read -r \
  operator_total \
  platform_grant_total \
  admin_platform_active \
  admin_tenant_active \
  tenant_operator_total \
  tenant_active_total \
  tenant_active_target \
  tenant_platform_total <<< "$state"

for count in \
  "$operator_total" "$platform_grant_total" "$admin_platform_active" \
  "$admin_tenant_active" "$tenant_operator_total" "$tenant_active_total" \
  "$tenant_active_target" "$tenant_platform_total"; do
  if [[ ! "$count" =~ ^[0-9]+$ ]]; then
    echo "::error::OPERATOR_STATE_QUERY_INVALID." >&2
    exit 1
  fi
done

if [ "$REQUESTED_BOOTSTRAP" = "true" ]; then
  if [ "$operator_total" -ne 0 ] || [ "$platform_grant_total" -ne 0 ]; then
    echo "::error::BOOTSTRAP_REQUIRES_EMPTY_DATABASE: Operators and Platform Grants must both be globally empty." >&2
    exit 1
  fi
  platform_bootstrap=true
else
  if [ "$admin_platform_active" -ne 1 ] || [ "$admin_tenant_active" -ne 1 ]; then
    echo "::error::EXPECTED_PLATFORM_OPERATOR_INACTIVE: bootstrap cannot restore or replace revoked authority." >&2
    exit 1
  fi
  platform_bootstrap=false
fi

case "$tenant_operator_total" in
  0)
    tenant_bootstrap=true
    ;;
  1)
    if [ "$tenant_active_total" -ne 1 ] ||
       [ "$tenant_active_target" -ne 1 ] ||
       [ "$tenant_platform_total" -ne 0 ]; then
      echo "::error::TENANT_OPERATOR_AUTHORITY_INVALID: expected exactly one active Tenant Grant and zero Platform Grants." >&2
      exit 1
    fi
    tenant_bootstrap=false
    ;;
  *)
    echo "::error::TENANT_OPERATOR_IDENTITY_AMBIGUOUS." >&2
    exit 1
    ;;
esac

printf 'platform_bootstrap=%s\n' "$platform_bootstrap" >> "$GITHUB_OUTPUT"
printf 'tenant_bootstrap=%s\n' "$tenant_bootstrap" >> "$GITHUB_OUTPUT"
