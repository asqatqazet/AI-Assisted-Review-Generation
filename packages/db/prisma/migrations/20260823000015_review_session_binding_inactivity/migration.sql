-- US-02.3: a successful browser-bound resume renews the inactivity window
-- using database time. SECURITY DEFINER resolves the opaque capability before
-- the caller knows which Tenant RLS context to set.
CREATE FUNCTION touch_live_review_session_browser_binding(
  p_route_handle_hash varchar,
  p_browser_capability_hash varchar
)
RETURNS TABLE (
  tenant_id uuid,
  location_id uuid,
  review_session_id uuid
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  UPDATE review_session_browser_bindings AS binding
  SET expires_at = LEAST(
    session.expires_at,
    clock_timestamp() + interval '24 hours'
  )
  FROM review_sessions AS session
  WHERE binding.route_handle_hash = p_route_handle_hash
    AND binding.browser_capability_hash = p_browser_capability_hash
    AND binding.revoked_at IS NULL
    AND binding.expires_at > clock_timestamp()
    AND session.id = binding.review_session_id
    AND session.tenant_id = binding.tenant_id
    AND session.location_id = binding.location_id
    AND session.status = 'OPEN'
    AND session.expires_at > clock_timestamp()
  RETURNING binding.tenant_id, binding.location_id, binding.review_session_id
$function$;

REVOKE ALL ON FUNCTION touch_live_review_session_browser_binding(
  varchar, varchar
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION touch_live_review_session_browser_binding(
  varchar, varchar
) TO context_svc;
