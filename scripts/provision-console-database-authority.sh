#!/usr/bin/env bash

set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${CONSOLE_DATABASE_AUTHORITY_SECRET:?CONSOLE_DATABASE_AUTHORITY_SECRET is required}"

if [[ ! "$CONSOLE_DATABASE_AUTHORITY_SECRET" =~ ^[0-9a-f]{64}$ ]]; then
  printf '%s\n' "CONSOLE_DATABASE_AUTHORITY_SECRET_INVALID" >&2
  exit 1
fi

PSQL_BIN="${PSQL_BIN:-psql}"
"$PSQL_BIN" "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 <<'SQL'
\getenv authority_secret_hex CONSOLE_DATABASE_AUTHORITY_SECRET
BEGIN;
INSERT INTO console_database_authority_keys (singleton, secret)
VALUES (true, decode(:'authority_secret_hex', 'hex'))
ON CONFLICT (singleton) DO UPDATE
SET secret = EXCLUDED.secret,
    rotated_at = clock_timestamp();
-- A rotated authority key must immediately invalidate bindings issued under
-- the previous key; waiting for their normal 30-second expiry is unnecessary
-- residual authority during an incident response rotation.
DELETE FROM console_operator_authorizations;
DELETE FROM console_operator_authority_nonces;
COMMIT;
SQL

printf '%s\n' "Console database authority provisioned."
