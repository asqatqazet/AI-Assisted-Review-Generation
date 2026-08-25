-- US-04.2 / P2: Prompt content stays immutable and content-addressed while
-- deployment is a separate, single-valued record for each Tenant + Action.

ALTER TABLE prompt_versions
  ADD COLUMN variables text[] NOT NULL DEFAULT '{}';

-- Historical fixtures predate the canonical hash contract. Give those rows a
-- stable canonical-shaped identity before making malformed hashes impossible.
-- New rows are hashed by the Context application over the full Prompt payload.
UPDATE prompt_versions
SET content_hash = 'sha256:' || encode(
  digest(
    convert_to(
      prompt_key || chr(31) || action::text || chr(31) || body || chr(31) ||
      array_to_string(variables, chr(31)),
      'UTF8'
    ),
    'sha256'
  ),
  'hex'
)
WHERE content_hash !~ '^sha256:[0-9a-f]{64}$';

ALTER TABLE prompt_versions
  ADD CONSTRAINT prompt_versions_canonical_content_hash CHECK (
    content_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  ADD CONSTRAINT prompt_versions_deployment_owner_unique
    UNIQUE (id, tenant_id, action);

CREATE TABLE prompt_deployments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  action generation_action NOT NULL,
  prompt_version_id uuid NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  deployed_by uuid,
  deployed_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT prompt_deployments_one_per_action UNIQUE (tenant_id, action),
  CONSTRAINT prompt_deployments_revision_positive CHECK (revision > 0),
  CONSTRAINT prompt_deployments_tenant_fk
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CONSTRAINT prompt_deployments_prompt_fk
    FOREIGN KEY (prompt_version_id, tenant_id, action)
    REFERENCES prompt_versions(id, tenant_id, action) ON DELETE RESTRICT,
  CONSTRAINT prompt_deployments_operator_fk
    FOREIGN KEY (deployed_by) REFERENCES operators(id) ON DELETE RESTRICT
);

CREATE INDEX prompt_deployments_tenant_idx
  ON prompt_deployments (tenant_id);

ALTER TABLE prompt_deployments ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompt_deployments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON prompt_deployments
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON prompt_deployments TO context_svc;

-- Published content is immutable. Mutable rollout state belongs in
-- prompt_deployments and configuration_drafts, never in these records.
CREATE FUNCTION reject_published_configuration_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'PUBLISHED_CONFIGURATION_IS_APPEND_ONLY'
    USING ERRCODE = '23514',
          TABLE = TG_TABLE_NAME;
END
$function$;

CREATE TRIGGER prompt_versions_append_only
BEFORE UPDATE OR DELETE ON prompt_versions
FOR EACH ROW
EXECUTE FUNCTION reject_published_configuration_mutation();

CREATE TRIGGER effective_configuration_snapshots_append_only
BEFORE UPDATE OR DELETE ON effective_configuration_snapshots
FOR EACH ROW
EXECUTE FUNCTION reject_published_configuration_mutation();

REVOKE UPDATE, DELETE, TRUNCATE ON prompt_versions, effective_configuration_snapshots FROM context_svc;

-- A Draft is mutable, but there is exactly one per configuration scope. The
-- partial indexes make NULL (Tenant scope) single-valued instead of relying on
-- PostgreSQL's default NULL-distinct uniqueness.
CREATE TABLE configuration_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  location_id uuid,
  base_revision bigint NOT NULL CHECK (base_revision > 0),
  changes jsonb NOT NULL CHECK (jsonb_typeof(changes) = 'array'),
  created_by uuid NOT NULL REFERENCES operators(id) ON DELETE RESTRICT,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT configuration_drafts_location_fk
    FOREIGN KEY (location_id, tenant_id)
    REFERENCES locations(id, tenant_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX configuration_drafts_tenant_scope_unique
  ON configuration_drafts (tenant_id) WHERE location_id IS NULL;
CREATE UNIQUE INDEX configuration_drafts_location_scope_unique
  ON configuration_drafts (tenant_id, location_id) WHERE location_id IS NOT NULL;

CREATE TABLE configuration_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  location_id uuid,
  revision bigint NOT NULL CHECK (revision > 0),
  changes jsonb NOT NULL CHECK (jsonb_typeof(changes) = 'array'),
  snapshot_ids uuid[] NOT NULL DEFAULT '{}',
  actor_id uuid NOT NULL REFERENCES operators(id) ON DELETE RESTRICT,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT configuration_audit_events_location_fk
    FOREIGN KEY (location_id, tenant_id)
    REFERENCES locations(id, tenant_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX configuration_audit_tenant_revision_unique
  ON configuration_audit_events (tenant_id, revision)
  WHERE location_id IS NULL;
CREATE UNIQUE INDEX configuration_audit_location_revision_unique
  ON configuration_audit_events (tenant_id, location_id, revision)
  WHERE location_id IS NOT NULL;

ALTER TABLE configuration_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE configuration_drafts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON configuration_drafts
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE configuration_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE configuration_audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON configuration_audit_events
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON configuration_drafts TO context_svc;
GRANT SELECT, INSERT ON configuration_audit_events TO context_svc;

-- A Platform route has one primary slot. The adapter also refuses a mutation
-- that would leave the slot empty; this index makes concurrent or ad-hoc
-- writers unable to create two primary models.
CREATE UNIQUE INDEX provider_models_single_primary_route
  ON provider_models (routing_priority)
  WHERE routing_priority = 1;

CREATE FUNCTION enforce_exactly_one_primary_provider_route()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF (
    SELECT count(*)
    FROM provider_models
    WHERE routing_priority = 1
  ) <> 1 THEN
    RAISE EXCEPTION 'PROVIDER_ROUTING_REQUIRES_EXACTLY_ONE_PRIMARY'
      USING ERRCODE = '23514',
            CONSTRAINT = 'provider_models_exactly_one_primary_route';
  END IF;
  RETURN NULL;
END
$function$;

CREATE CONSTRAINT TRIGGER provider_models_exactly_one_primary_route
AFTER INSERT OR UPDATE OR DELETE ON provider_models
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION enforce_exactly_one_primary_provider_route();

-- Entry admission is a read of the newest published Location snapshot. Draft
-- rows and mutable live settings are deliberately absent from this function.
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
    snapshot.payload #>> '{settings,entryMode}',
    (snapshot.payload #>> '{settings,requireVerifiedExperience}')::boolean
  INTO
    v_tenant_id,
    v_location_id,
    v_entry_mode_key,
    v_requires_verification
  FROM tenants AS tenant
  JOIN locations AS location ON location.tenant_id = tenant.id
  JOIN LATERAL (
    SELECT published.payload
    FROM effective_configuration_snapshots AS published
    WHERE published.tenant_id = tenant.id
      AND published.location_id = location.id
      AND published.schema_version = 2
      AND published.payload ->> 'tenantId' = tenant.id::text
      AND published.payload ->> 'locationId' = location.id::text
      AND published.payload ->> 'snapshotId' = published.id::text
      AND jsonb_typeof(
        published.payload #> '{settings,requireVerifiedExperience}'
      ) = 'boolean'
    ORDER BY published.created_at DESC, published.id DESC
    LIMIT 1
  ) AS snapshot ON true
  JOIN entry_mode_definitions AS mode
    ON mode.key = snapshot.payload #>> '{settings,entryMode}'
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
