-- US-02.2: admission uses the accepted Location -> Tenant -> Platform
-- precedence for entry mode and verified-experience policy.
CREATE OR REPLACE FUNCTION prepare_entry_challenge(
  p_tenant_slug varchar,
  p_location_slug varchar,
  p_invitation_token_hash varchar,
  p_route_handle_hash varchar,
  p_browser_capability_hash varchar,
  p_table_ref_hash varchar,
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
  v_entry_mode_key varchar(80);
  v_requires_verification boolean;
  v_invitation_token_id uuid;
  v_visit_id uuid;
BEGIN
  SELECT
    tenant.id,
    location.id,
    mode.key,
    COALESCE(
      CASE
        WHEN jsonb_typeof(location.overrides -> 'requireVerifiedExperience') = 'boolean'
          THEN (location.overrides ->> 'requireVerifiedExperience')::boolean
      END,
      CASE
        WHEN jsonb_typeof(tenant.policy -> 'requireVerifiedExperience') = 'boolean'
          THEN (tenant.policy ->> 'requireVerifiedExperience')::boolean
      END,
      CASE
        WHEN jsonb_typeof(platform.default_policy -> 'requireVerifiedExperience') = 'boolean'
          THEN (platform.default_policy ->> 'requireVerifiedExperience')::boolean
      END,
      false
    )
  INTO
    v_tenant_id,
    v_location_id,
    v_entry_mode_key,
    v_requires_verification
  FROM tenants AS tenant
  JOIN locations AS location ON location.tenant_id = tenant.id
  LEFT JOIN platform_settings AS platform ON platform.id = 'platform'
  JOIN entry_mode_definitions AS mode
    ON mode.key = COALESCE(
      NULLIF(location.overrides ->> 'entryMode', ''),
      tenant.default_entry_mode_key,
      NULLIF(platform.default_policy ->> 'entryMode', ''),
      'invite'
    )
  WHERE tenant.slug = p_tenant_slug
    AND tenant.status = 'ACTIVE'
    AND location.slug = p_location_slug
    AND location.status = 'ACTIVE'
    AND mode.status = 'ACTIVE'
  LIMIT 1;

  IF v_tenant_id IS NULL OR p_expires_at <= clock_timestamp() THEN
    RETURN false;
  END IF;

  IF p_invitation_token_hash IS NULL THEN
    IF v_entry_mode_key = 'invite' OR v_requires_verification THEN
      RETURN false;
    END IF;
  ELSE
    IF v_entry_mode_key = 'open-qr' THEN
      RETURN false;
    END IF;

    SELECT token.id, token.visit_id
    INTO v_invitation_token_id, v_visit_id
    FROM invitation_tokens AS token
    WHERE token.token_hash = p_invitation_token_hash
      AND token.tenant_id = v_tenant_id
      AND token.location_id = v_location_id
      AND token.consumed_at IS NULL
      AND token.expires_at > clock_timestamp()
    LIMIT 1;

    IF v_invitation_token_id IS NULL OR
       (v_requires_verification AND v_visit_id IS NULL) THEN
      RETURN false;
    END IF;
  END IF;

  INSERT INTO entry_challenges (
    tenant_id,
    location_id,
    invitation_token_id,
    visit_id,
    entry_mode_key,
    route_handle_hash,
    browser_capability_hash,
    table_ref_hash,
    verification_required,
    expires_at
  ) VALUES (
    v_tenant_id,
    v_location_id,
    v_invitation_token_id,
    v_visit_id,
    v_entry_mode_key,
    p_route_handle_hash,
    p_browser_capability_hash,
    p_table_ref_hash,
    v_requires_verification AND v_invitation_token_id IS NOT NULL,
    p_expires_at
  );
  RETURN true;
EXCEPTION
  WHEN unique_violation THEN
    RETURN false;
END
$function$;

REVOKE ALL ON FUNCTION prepare_entry_challenge(
  varchar, varchar, varchar, varchar, varchar, varchar, timestamptz
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prepare_entry_challenge(
  varchar, varchar, varchar, varchar, varchar, varchar, timestamptz
) TO context_svc;
