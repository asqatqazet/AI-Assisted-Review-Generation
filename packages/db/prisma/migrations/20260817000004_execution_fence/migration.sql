-- US-03.2: database-time lease preparation, execution claiming, and expiry
-- cancellation. These functions run with the caller's role and forced RLS.
ALTER TYPE provider_attempt_status ADD VALUE 'RUNNING' BEFORE 'SUCCEEDED';

ALTER TABLE provider_attempts
  DROP CONSTRAINT provider_attempts_billing_shape,
  ADD CONSTRAINT provider_attempts_billing_shape CHECK (
    (billed_at IS NULL AND cost_micros = 0) OR
    (billed_at IS NOT NULL AND price_rate_id IS NOT NULL)
  );

CREATE FUNCTION prepare_generation_lease(
  p_tenant_id uuid,
  p_location_id uuid,
  p_review_session_id uuid,
  p_generation_batch_id uuid,
  p_generation_id uuid,
  p_permit_jti varchar(128),
  p_permit_expires_at timestamptz
)
RETURNS TABLE (
  outcome text,
  lease_id uuid,
  lease_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_now timestamptz;
  v_lease_id uuid;
  v_lease_expires_at timestamptz;
BEGIN
  v_now := clock_timestamp();

  INSERT INTO execution_leases (
    tenant_id,
    location_id,
    review_session_id,
    generation_batch_id,
    generation_id,
    permit_jti,
    permit_expires_at,
    lease_expires_at
  )
  SELECT
    p_tenant_id,
    p_location_id,
    p_review_session_id,
    p_generation_batch_id,
    p_generation_id,
    p_permit_jti,
    p_permit_expires_at,
    LEAST(p_permit_expires_at, v_now + interval '45 seconds')
  WHERE p_permit_expires_at > v_now
  ON CONFLICT (permit_jti) DO NOTHING
  RETURNING id, execution_leases.lease_expires_at
  INTO v_lease_id, v_lease_expires_at;

  IF v_lease_id IS NOT NULL THEN
    RETURN QUERY
      SELECT 'leased'::text, v_lease_id, v_lease_expires_at;
    RETURN;
  END IF;

  SELECT lease.id, lease.lease_expires_at
  INTO v_lease_id, v_lease_expires_at
  FROM execution_leases AS lease
  WHERE lease.permit_jti = p_permit_jti
    AND lease.tenant_id = p_tenant_id
    AND lease.location_id = p_location_id
    AND lease.review_session_id = p_review_session_id
    AND lease.generation_batch_id = p_generation_batch_id
    AND lease.generation_id = p_generation_id;

  IF v_lease_id IS NOT NULL THEN
    RETURN QUERY
      SELECT 'existing'::text, v_lease_id, v_lease_expires_at;
    RETURN;
  END IF;

  IF p_permit_expires_at <= v_now THEN
    RAISE EXCEPTION 'PERMIT_EXPIRED' USING ERRCODE = 'P0001';
  END IF;

  RAISE EXCEPTION 'LEASE_BINDING_MISMATCH' USING ERRCODE = 'P0001';
END
$function$;

CREATE FUNCTION claim_generation_attempt(
  p_execution_lease_id uuid,
  p_tenant_id uuid,
  p_location_id uuid,
  p_review_session_id uuid,
  p_generation_batch_id uuid,
  p_generation_id uuid,
  p_permit_jti varchar(128),
  p_activation_expires_at timestamptz,
  p_attempt_ordinal integer,
  p_provider_model_id uuid,
  p_price_rate_id uuid,
  p_request_payload jsonb
)
RETURNS TABLE (
  outcome text,
  attempt_id uuid
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_now timestamptz;
  v_attempt_id uuid;
BEGIN
  v_now := clock_timestamp();

  IF p_attempt_ordinal <> 1 THEN
    RAISE EXCEPTION 'ATTEMPT_NOT_RESERVED' USING ERRCODE = 'P0001';
  END IF;

  WITH claimed_lease AS (
    UPDATE execution_leases
    SET
      state = 'RUNNING',
      running_at = v_now,
      activation_expires_at = p_activation_expires_at
    WHERE id = p_execution_lease_id
      AND tenant_id = p_tenant_id
      AND location_id = p_location_id
      AND review_session_id = p_review_session_id
      AND generation_batch_id = p_generation_batch_id
      AND generation_id = p_generation_id
      AND permit_jti = p_permit_jti
      AND state = 'LEASED'
      AND lease_expires_at > v_now
      AND p_activation_expires_at > v_now
      AND p_activation_expires_at <= lease_expires_at
    RETURNING
      id,
      tenant_id,
      location_id,
      review_session_id,
      generation_id
  ), inserted_attempt AS (
    INSERT INTO provider_attempts (
      tenant_id,
      location_id,
      review_session_id,
      generation_id,
      execution_lease_id,
      provider_model_id,
      price_rate_id,
      attempt_ordinal,
      status,
      request_payload,
      started_at
    )
    SELECT
      claimed_lease.tenant_id,
      claimed_lease.location_id,
      claimed_lease.review_session_id,
      claimed_lease.generation_id,
      claimed_lease.id,
      p_provider_model_id,
      p_price_rate_id,
      p_attempt_ordinal,
      'RUNNING'::provider_attempt_status,
      p_request_payload,
      v_now
    FROM claimed_lease
    RETURNING id
  )
  SELECT id
  INTO v_attempt_id
  FROM inserted_attempt;

  IF v_attempt_id IS NOT NULL THEN
    RETURN QUERY SELECT 'claimed'::text, v_attempt_id;
    RETURN;
  END IF;

  SELECT attempt.id
  INTO v_attempt_id
  FROM provider_attempts AS attempt
  WHERE execution_lease_id = p_execution_lease_id
    AND attempt_ordinal = p_attempt_ordinal
    AND tenant_id = p_tenant_id
    AND location_id = p_location_id
    AND review_session_id = p_review_session_id
    AND generation_id = p_generation_id;

  IF v_attempt_id IS NOT NULL THEN
    RETURN QUERY SELECT 'existing'::text, v_attempt_id;
    RETURN;
  END IF;

  RAISE EXCEPTION 'EXECUTION_NOT_CLAIMABLE' USING ERRCODE = 'P0001';
END
$function$;

CREATE FUNCTION cancel_expired_generation_lease(
  p_execution_lease_id uuid,
  p_tenant_id uuid,
  p_location_id uuid,
  p_review_session_id uuid,
  p_generation_batch_id uuid,
  p_generation_id uuid,
  p_permit_jti varchar(128)
)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_now timestamptz;
  v_state execution_lease_state;
BEGIN
  v_now := clock_timestamp();

  UPDATE execution_leases
  SET
    state = 'CANCELLED',
    cancelled_at = v_now
  WHERE id = p_execution_lease_id
    AND tenant_id = p_tenant_id
    AND location_id = p_location_id
    AND review_session_id = p_review_session_id
    AND generation_batch_id = p_generation_batch_id
    AND generation_id = p_generation_id
    AND permit_jti = p_permit_jti
    AND state = 'LEASED'
    AND lease_expires_at <= v_now
  RETURNING state INTO v_state;

  IF v_state = 'CANCELLED' THEN
    RETURN 'cancelled';
  END IF;

  SELECT lease.state
  INTO v_state
  FROM execution_leases AS lease
  WHERE lease.id = p_execution_lease_id
    AND lease.tenant_id = p_tenant_id
    AND lease.location_id = p_location_id
    AND lease.review_session_id = p_review_session_id
    AND lease.generation_batch_id = p_generation_batch_id
    AND lease.generation_id = p_generation_id
    AND lease.permit_jti = p_permit_jti;

  IF v_state = 'RUNNING' THEN
    RETURN 'running';
  END IF;
  IF v_state = 'TERMINAL' THEN
    RETURN 'terminal';
  END IF;
  IF v_state = 'CANCELLED' THEN
    RETURN 'cancelled';
  END IF;
  IF v_state = 'LEASED' THEN
    RAISE EXCEPTION 'LEASE_NOT_EXPIRED' USING ERRCODE = 'P0001';
  END IF;

  RETURN 'no-lease';
END
$function$;

REVOKE ALL ON FUNCTION prepare_generation_lease(
  uuid, uuid, uuid, uuid, uuid, varchar, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION claim_generation_attempt(
  uuid, uuid, uuid, uuid, uuid, uuid, varchar, timestamptz, integer, uuid, uuid, jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION cancel_expired_generation_lease(
  uuid, uuid, uuid, uuid, uuid, uuid, varchar
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION prepare_generation_lease(
  uuid, uuid, uuid, uuid, uuid, varchar, timestamptz
) TO generation_svc;
GRANT EXECUTE ON FUNCTION claim_generation_attempt(
  uuid, uuid, uuid, uuid, uuid, uuid, varchar, timestamptz, integer, uuid, uuid, jsonb
) TO generation_svc;
GRANT EXECUTE ON FUNCTION cancel_expired_generation_lease(
  uuid, uuid, uuid, uuid, uuid, uuid, varchar
) TO generation_svc;
