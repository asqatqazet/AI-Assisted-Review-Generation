-- Reconciliation reads only a fully scoped lease state. Forced RLS remains
-- active because this is an invoker-rights function.
CREATE FUNCTION generation_lease_status(
  p_tenant_id uuid,
  p_location_id uuid,
  p_review_session_id uuid,
  p_generation_batch_id uuid,
  p_generation_id uuid,
  p_permit_jti varchar(128)
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_state execution_lease_state;
BEGIN
  SELECT lease.state
  INTO v_state
  FROM execution_leases AS lease
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
END
$function$;

REVOKE ALL ON FUNCTION generation_lease_status(
  uuid, uuid, uuid, uuid, uuid, varchar
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION generation_lease_status(
  uuid, uuid, uuid, uuid, uuid, varchar
) TO generation_svc;
