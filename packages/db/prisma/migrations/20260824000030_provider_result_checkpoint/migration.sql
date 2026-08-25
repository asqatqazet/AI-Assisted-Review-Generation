-- A Provider result must survive a failure between paid Provider I/O and the
-- multi-row Generation terminal transaction. The raw structured output,
-- receipt, and validated terminal artifact remain distinct audit facts.
ALTER TYPE provider_attempt_status ADD VALUE 'CHECKPOINTED' BEFORE 'SUCCEEDED';

ALTER TABLE generations
  ALTER COLUMN provider_output TYPE jsonb
  USING CASE
    WHEN provider_output IS NULL THEN NULL
    ELSE to_jsonb(provider_output)
  END;

ALTER TABLE provider_attempts
  ADD COLUMN provider_output jsonb,
  ADD COLUMN result_checkpoint jsonb,
  ADD COLUMN result_checkpointed_at timestamptz,
  -- Provider calls are bounded to 60 seconds. Five seconds of persistence
  -- grace gives every Attempt a DB-minted recovery deadline even when the
  -- execution process disappears before it can report a timeout.
  ADD COLUMN result_deadline_at timestamptz NOT NULL
    DEFAULT (clock_timestamp() + interval '65 seconds');

UPDATE provider_attempts
SET result_deadline_at = started_at + interval '65 seconds';

ALTER TABLE provider_attempts
  ADD CONSTRAINT provider_attempts_checkpoint_shape CHECK (
    (result_checkpoint IS NULL AND result_checkpointed_at IS NULL) OR
    (result_checkpoint IS NOT NULL AND result_checkpointed_at IS NOT NULL)
  ),
  ADD CONSTRAINT provider_attempts_provider_output_object CHECK (
    provider_output IS NULL OR jsonb_typeof(provider_output) = 'object'
  ),
  ADD CONSTRAINT provider_attempts_result_checkpoint_object CHECK (
    result_checkpoint IS NULL OR jsonb_typeof(result_checkpoint) = 'object'
  ),
  ADD CONSTRAINT provider_attempts_result_deadline_after_start CHECK (
    result_deadline_at > started_at
  );

-- Every recovery observer uses this one row-level CAS. A checkpoint and an
-- expired uncheckpointed result both require RUNNING, so PostgreSQL permits
-- exactly one winner. The Lease deliberately remains RUNNING: an
-- indeterminate paid call is fail-closed and requires operator reconciliation.
CREATE FUNCTION public.converge_generation_attempt_recovery(
  p_tenant_id uuid,
  p_location_id uuid,
  p_review_session_id uuid,
  p_generation_batch_id uuid,
  p_generation_id uuid,
  p_permit_jti varchar(128),
  p_execution_lease_id uuid,
  p_attempt_id uuid
) RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_now timestamptz;
  v_attempt_status text;
  v_error_code text;
BEGIN
  v_now := clock_timestamp();

  UPDATE public.provider_attempts AS attempt
  SET
    status = 'TIMED_OUT',
    error_code = 'PROVIDER_RESULT_INDETERMINATE',
    finished_at = v_now
  FROM public.execution_leases AS lease
  WHERE lease.id = attempt.execution_lease_id
    AND lease.tenant_id = attempt.tenant_id
    AND lease.location_id = attempt.location_id
    AND lease.review_session_id = attempt.review_session_id
    AND lease.generation_id = attempt.generation_id
    AND lease.tenant_id = p_tenant_id
    AND lease.location_id = p_location_id
    AND lease.review_session_id = p_review_session_id
    AND lease.generation_batch_id = p_generation_batch_id
    AND lease.generation_id = p_generation_id
    AND lease.permit_jti = p_permit_jti
    AND (p_execution_lease_id IS NULL OR lease.id = p_execution_lease_id)
    AND (p_attempt_id IS NULL OR attempt.id = p_attempt_id)
    AND lease.state = 'RUNNING'
    AND attempt.status = 'RUNNING'
    AND attempt.result_checkpoint IS NULL
    AND attempt.result_deadline_at <= v_now;

  SELECT attempt.status::text, attempt.error_code
  INTO v_attempt_status, v_error_code
  FROM public.provider_attempts AS attempt
  JOIN public.execution_leases AS lease
    ON lease.id = attempt.execution_lease_id
   AND lease.tenant_id = attempt.tenant_id
   AND lease.location_id = attempt.location_id
   AND lease.review_session_id = attempt.review_session_id
   AND lease.generation_id = attempt.generation_id
  WHERE lease.tenant_id = p_tenant_id
    AND lease.location_id = p_location_id
    AND lease.review_session_id = p_review_session_id
    AND lease.generation_batch_id = p_generation_batch_id
    AND lease.generation_id = p_generation_id
    AND lease.permit_jti = p_permit_jti
    AND (p_execution_lease_id IS NULL OR lease.id = p_execution_lease_id)
    AND (p_attempt_id IS NULL OR attempt.id = p_attempt_id)
  ORDER BY attempt.attempt_ordinal
  LIMIT 1;

  IF v_attempt_status = 'CHECKPOINTED' THEN
    RETURN 'checkpointed';
  END IF;
  IF v_attempt_status = 'TIMED_OUT'
     AND v_error_code = 'PROVIDER_RESULT_INDETERMINATE' THEN
    RETURN 'indeterminate';
  END IF;
  RETURN 'none';
END;
$$;

REVOKE ALL ON FUNCTION public.converge_generation_attempt_recovery(
  uuid, uuid, uuid, uuid, uuid, varchar, uuid, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.converge_generation_attempt_recovery(
  uuid, uuid, uuid, uuid, uuid, varchar, uuid, uuid
) TO generation_svc;

-- Status is an internal reconciliation poll as well as a read. It therefore
-- converges a dead RUNNING/no-checkpoint process even when no reviewer retries.
CREATE OR REPLACE FUNCTION public.generation_lease_status(
  p_tenant_id uuid,
  p_location_id uuid,
  p_review_session_id uuid,
  p_generation_batch_id uuid,
  p_generation_id uuid,
  p_permit_jti varchar(128)
) RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_recovery text;
  v_state public.execution_lease_state;
BEGIN
  v_recovery := public.converge_generation_attempt_recovery(
    p_tenant_id, p_location_id, p_review_session_id,
    p_generation_batch_id, p_generation_id, p_permit_jti,
    NULL, NULL
  );
  IF v_recovery = 'indeterminate' THEN
    RETURN v_recovery;
  END IF;

  SELECT lease.state
  INTO v_state
  FROM public.execution_leases AS lease
  WHERE lease.tenant_id = p_tenant_id
    AND lease.location_id = p_location_id
    AND lease.review_session_id = p_review_session_id
    AND lease.generation_batch_id = p_generation_batch_id
    AND lease.generation_id = p_generation_id
    AND lease.permit_jti = p_permit_jti;

  IF v_state IS NULL THEN
    RETURN 'no-lease';
  END IF;
  RETURN lower(v_state::text);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_expired_generation_lease(
  p_execution_lease_id uuid,
  p_tenant_id uuid,
  p_location_id uuid,
  p_review_session_id uuid,
  p_generation_batch_id uuid,
  p_generation_id uuid,
  p_permit_jti varchar(128)
) RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_now timestamptz;
  v_recovery text;
  v_state public.execution_lease_state;
BEGIN
  v_now := clock_timestamp();
  v_recovery := public.converge_generation_attempt_recovery(
    p_tenant_id, p_location_id, p_review_session_id,
    p_generation_batch_id, p_generation_id, p_permit_jti,
    p_execution_lease_id, NULL
  );
  IF v_recovery = 'indeterminate' THEN
    RETURN v_recovery;
  END IF;

  UPDATE public.execution_leases
  SET state = 'CANCELLED', cancelled_at = v_now
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
  FROM public.execution_leases AS lease
  WHERE lease.id = p_execution_lease_id
    AND lease.tenant_id = p_tenant_id
    AND lease.location_id = p_location_id
    AND lease.review_session_id = p_review_session_id
    AND lease.generation_batch_id = p_generation_batch_id
    AND lease.generation_id = p_generation_id
    AND lease.permit_jti = p_permit_jti;

  IF v_state = 'RUNNING' THEN RETURN 'running'; END IF;
  IF v_state = 'TERMINAL' THEN RETURN 'terminal'; END IF;
  IF v_state = 'CANCELLED' THEN RETURN 'cancelled'; END IF;
  IF v_state = 'LEASED' THEN
    RAISE EXCEPTION 'LEASE_NOT_EXPIRED' USING ERRCODE = 'P0001';
  END IF;
  RETURN 'no-lease';
END;
$$;

-- Revisions are edits of reviewer-owned body text only. System annotations are
-- immutable provenance and therefore inherit byte-for-byte from revision one.
UPDATE draft_revisions
SET annotations = '{"systemAnnotations":[]}'::jsonb
WHERE annotations = '{}'::jsonb;

UPDATE draft_revisions AS revision
SET annotations = origin.annotations
FROM draft_revisions AS origin
WHERE origin.draft_id = revision.draft_id
  AND origin.tenant_id = revision.tenant_id
  AND origin.location_id = revision.location_id
  AND origin.review_session_id = revision.review_session_id
  AND origin.revision = 1
  AND revision.revision > 1
  AND revision.annotations IS DISTINCT FROM origin.annotations;

-- The normal Generation-detail projection deliberately has no providerOutput
-- key. Only the separately authorized audit function can attach the raw
-- structured Provider result, and only after re-checking may_read_raw.
CREATE OR REPLACE FUNCTION public.console_execution_generation_detail_audit(
  p_authorization_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  auth_record public.console_execution_read_authorizations%ROWTYPE;
  projection jsonb;
  raw_provider_output jsonb;
BEGIN
  SELECT * INTO auth_record
  FROM public.console_execution_read_authorizations
  WHERE id = p_authorization_id
    AND expires_at > clock_timestamp()
    AND query->>'view' = 'generation-detail';
  IF NOT FOUND OR NOT auth_record.may_read_raw THEN
    RETURN jsonb_build_object('status', 'not-found');
  END IF;

  projection := public.console_execution_generation_detail(
    to_jsonb(auth_record.tenant_ids),
    auth_record.location_id,
    (auth_record.query->>'generationId')::uuid,
    true
  );
  IF projection->>'status' <> 'generation-detail' THEN
    RETURN projection;
  END IF;

  SELECT generation.provider_output
    INTO raw_provider_output
    FROM public.generations AS generation
    WHERE generation.id = (auth_record.query->>'generationId')::uuid
      AND generation.tenant_id = ANY(auth_record.tenant_ids)
      AND (
        auth_record.location_id IS NULL OR
        generation.location_id = auth_record.location_id
      );
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not-found');
  END IF;

  RETURN jsonb_set(
    projection,
    '{generation,providerOutput}',
    COALESCE(raw_provider_output, 'null'::jsonb),
    true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.console_execution_generation_detail_audit(uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.console_execution_generation_detail_audit(uuid)
  TO generation_svc;
