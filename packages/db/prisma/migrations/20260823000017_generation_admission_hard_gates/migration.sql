-- Reviewer Generation has one Platform-wide concurrency and rolling-window
-- budget. This ledger deliberately stores no Tenant identifier or request
-- content, so enforcing a global capacity cannot expose one Tenant to another.
CREATE TABLE IF NOT EXISTS platform_generation_admissions (
  reservation_id uuid PRIMARY KEY
    REFERENCES budget_reservations(id) ON DELETE CASCADE,
  admitted_at timestamptz(6) NOT NULL DEFAULT clock_timestamp(),
  funded boolean NOT NULL,
  active boolean NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS platform_generation_admissions_admitted_idx
  ON platform_generation_admissions(admitted_at);

REVOKE ALL ON platform_generation_admissions FROM PUBLIC;

CREATE OR REPLACE FUNCTION claim_platform_generation_capacity(
  p_reservation_id uuid,
  p_funded boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  admitted_now timestamptz(6) := clock_timestamp();
BEGIN
  -- One lock serializes all Platform counts and the new ledger row.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'platform-reviewer-generation-admission', 0
  ));

  IF NULLIF(current_setting('app.tenant_id', true), '') IS NULL OR NOT EXISTS (
    SELECT 1
    FROM budget_reservations
    WHERE id = p_reservation_id
      AND tenant_id = NULLIF(
        current_setting('app.tenant_id', true), ''
      )::uuid
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'PGA04',
      MESSAGE = 'GENERATION_PLATFORM_RESERVATION_SCOPE_INVALID';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM platform_generation_admissions
    WHERE active
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'PGA01',
      MESSAGE = 'GENERATION_PLATFORM_ACTIVE_LIMIT';
  END IF;

  IF (
    SELECT count(*)
    FROM platform_generation_admissions
    WHERE admitted_at > admitted_now - interval '1 minute'
  ) >= 5 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'PGA02',
      MESSAGE = 'GENERATION_PLATFORM_MINUTE_LIMIT';
  END IF;

  IF p_funded AND (
    SELECT count(*)
    FROM platform_generation_admissions
    WHERE funded
      AND admitted_at > admitted_now - interval '1 day'
  ) >= 30 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'PGA03',
      MESSAGE = 'GENERATION_PLATFORM_FUNDED_DAILY_LIMIT';
  END IF;

  INSERT INTO platform_generation_admissions (
    reservation_id, admitted_at, funded, active
  ) VALUES (
    p_reservation_id, admitted_now, p_funded, true
  );
END
$function$;

CREATE OR REPLACE FUNCTION release_platform_generation_capacity(
  p_reservation_id uuid
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  UPDATE platform_generation_admissions
  SET active = false
  WHERE reservation_id = p_reservation_id
    AND NULLIF(current_setting('app.tenant_id', true), '') IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM budget_reservations
      WHERE id = p_reservation_id
        AND tenant_id = NULLIF(
          current_setting('app.tenant_id', true), ''
        )::uuid
    )
$function$;

REVOKE ALL ON FUNCTION claim_platform_generation_capacity(uuid, boolean)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION release_platform_generation_capacity(uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_platform_generation_capacity(uuid, boolean)
  TO context_svc;
GRANT EXECUTE ON FUNCTION release_platform_generation_capacity(uuid)
  TO context_svc;
