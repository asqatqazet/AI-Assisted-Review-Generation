-- US-01.3: short-lived, browser-bound open-QR entry capability.
CREATE TABLE entry_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  location_id uuid NOT NULL,
  route_handle_hash varchar(128) NOT NULL UNIQUE,
  browser_capability_hash varchar(128) NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT entry_challenges_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT entry_challenges_tenant_fk FOREIGN KEY (tenant_id)
    REFERENCES tenants(id) ON DELETE RESTRICT,
  CONSTRAINT entry_challenges_location_scope_fk
    FOREIGN KEY (location_id, tenant_id)
    REFERENCES locations(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT entry_challenges_scope_unique UNIQUE (id, tenant_id, location_id)
);

CREATE INDEX entry_challenges_browser_scope_idx
  ON entry_challenges(tenant_id, location_id, browser_capability_hash);

ALTER TABLE entry_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE entry_challenges FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON entry_challenges
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON entry_challenges TO context_svc;

CREATE FUNCTION prepare_open_qr_entry_challenge(
  p_tenant_slug varchar,
  p_location_slug varchar,
  p_route_handle_hash varchar,
  p_browser_capability_hash varchar,
  p_expires_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_tenant_id uuid;
  v_location_id uuid;
BEGIN
  SELECT tenant.id, location.id
  INTO v_tenant_id, v_location_id
  FROM tenants AS tenant
  JOIN locations AS location ON location.tenant_id = tenant.id
  WHERE tenant.slug = p_tenant_slug
    AND tenant.status = 'ACTIVE'
    AND tenant.default_entry_mode_key = 'open-qr'
    AND location.slug = p_location_slug
    AND location.status = 'ACTIVE';

  IF v_tenant_id IS NULL OR p_expires_at <= clock_timestamp() THEN
    RETURN false;
  END IF;

  INSERT INTO entry_challenges (
    tenant_id, location_id, route_handle_hash,
    browser_capability_hash, expires_at
  ) VALUES (
    v_tenant_id, v_location_id, p_route_handle_hash,
    p_browser_capability_hash, p_expires_at
  );
  RETURN true;
END
$function$;

CREATE FUNCTION resolve_live_entry_challenge(
  p_route_handle_hash varchar,
  p_browser_capability_hash varchar
)
RETURNS TABLE (challenge_id uuid, tenant_id uuid, location_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT challenge.id, challenge.tenant_id, challenge.location_id
  FROM entry_challenges AS challenge
  WHERE challenge.route_handle_hash = p_route_handle_hash
    AND challenge.browser_capability_hash = p_browser_capability_hash
    AND challenge.consumed_at IS NULL
    AND challenge.expires_at > clock_timestamp()
  LIMIT 1
$function$;

REVOKE ALL ON FUNCTION prepare_open_qr_entry_challenge(
  varchar, varchar, varchar, varchar, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION resolve_live_entry_challenge(varchar, varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prepare_open_qr_entry_challenge(
  varchar, varchar, varchar, varchar, timestamptz
) TO context_svc;
GRANT EXECUTE ON FUNCTION resolve_live_entry_challenge(varchar, varchar)
  TO context_svc;
