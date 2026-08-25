-- US-02.1/US-02.2: browser-bound Invitation Token admission and pending
-- verification. Raw tokens, verification evidence and table references never
-- enter PostgreSQL; only their one-way hashes cross this boundary.
ALTER TABLE entry_challenges
  ADD COLUMN invitation_token_id uuid,
  ADD COLUMN visit_id uuid,
  ADD COLUMN entry_mode_key varchar(80) NOT NULL DEFAULT 'open-qr',
  ADD COLUMN table_ref_hash varchar(128),
  ADD COLUMN verification_required boolean NOT NULL DEFAULT false,
  ADD COLUMN provisional_rating integer,
  ADD COLUMN provisional_action generation_action,
  ADD COLUMN verification_failed_at timestamptz,
  ADD CONSTRAINT entry_challenges_entry_mode_check
    CHECK (entry_mode_key IN ('invite', 'open-qr', 'both')),
  ADD CONSTRAINT entry_challenges_provisional_selection_shape
    CHECK (
      (provisional_rating IS NULL AND provisional_action IS NULL) OR
      (provisional_rating BETWEEN 1 AND 5 AND provisional_action IS NOT NULL)
    ),
  ADD CONSTRAINT entry_challenges_verification_source_check
    CHECK (NOT verification_required OR (invitation_token_id IS NOT NULL AND visit_id IS NOT NULL)),
  ADD CONSTRAINT entry_challenges_visit_source_check
    CHECK (visit_id IS NULL OR invitation_token_id IS NOT NULL),
  ADD CONSTRAINT entry_challenges_invitation_scope_fk
    FOREIGN KEY (invitation_token_id, tenant_id, location_id)
    REFERENCES invitation_tokens(id, tenant_id, location_id) ON DELETE RESTRICT,
  ADD CONSTRAINT entry_challenges_visit_scope_fk
    FOREIGN KEY (visit_id, tenant_id, location_id)
    REFERENCES visits(id, tenant_id, location_id) ON DELETE RESTRICT;

CREATE INDEX entry_challenges_invitation_idx
  ON entry_challenges(invitation_token_id);

DROP FUNCTION prepare_open_qr_entry_challenge(
  varchar, varchar, varchar, varchar, timestamptz
);
DROP FUNCTION resolve_live_entry_challenge(varchar, varchar);

CREATE FUNCTION prepare_entry_challenge(
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
      false
    )
  INTO
    v_tenant_id,
    v_location_id,
    v_entry_mode_key,
    v_requires_verification
  FROM tenants AS tenant
  JOIN locations AS location ON location.tenant_id = tenant.id
  JOIN entry_mode_definitions AS mode
    ON mode.key = COALESCE(
      NULLIF(location.overrides ->> 'entryMode', ''),
      tenant.default_entry_mode_key
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

CREATE FUNCTION resolve_live_entry_challenge(
  p_route_handle_hash varchar,
  p_browser_capability_hash varchar
)
RETURNS TABLE (
  challenge_id uuid,
  tenant_id uuid,
  location_id uuid,
  invitation_token_id uuid,
  visit_id uuid,
  entry_mode_key varchar,
  verification_required boolean,
  provisional_rating integer,
  provisional_action generation_action,
  verification_failed_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT
    challenge.id,
    challenge.tenant_id,
    challenge.location_id,
    challenge.invitation_token_id,
    challenge.visit_id,
    challenge.entry_mode_key,
    challenge.verification_required,
    challenge.provisional_rating,
    challenge.provisional_action,
    challenge.verification_failed_at
  FROM entry_challenges AS challenge
  LEFT JOIN invitation_tokens AS token
    ON token.id = challenge.invitation_token_id
   AND token.tenant_id = challenge.tenant_id
   AND token.location_id = challenge.location_id
  WHERE challenge.route_handle_hash = p_route_handle_hash
    AND challenge.browser_capability_hash = p_browser_capability_hash
    AND challenge.consumed_at IS NULL
    AND challenge.expires_at > clock_timestamp()
    AND (
      challenge.invitation_token_id IS NULL OR
      (
        token.consumed_at IS NULL AND
        token.expires_at > clock_timestamp()
      )
    )
  LIMIT 1
$function$;

REVOKE ALL ON FUNCTION prepare_entry_challenge(
  varchar, varchar, varchar, varchar, varchar, varchar, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION resolve_live_entry_challenge(varchar, varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prepare_entry_challenge(
  varchar, varchar, varchar, varchar, varchar, varchar, timestamptz
) TO context_svc;
GRANT EXECUTE ON FUNCTION resolve_live_entry_challenge(varchar, varchar)
  TO context_svc;
