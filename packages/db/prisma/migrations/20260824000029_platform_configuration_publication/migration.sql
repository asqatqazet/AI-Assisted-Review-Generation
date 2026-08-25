-- Platform policy, Provider routing, and Price Rates share one publication
-- boundary because each can change every Location's next immutable snapshot.
-- This aggregate is intentionally separate from Tenant configuration_drafts.

CREATE FUNCTION platform_configuration_required_capabilities(
  p_changes jsonb
) RETURNS text[]
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = pg_catalog, public, pg_temp
AS $function$
  SELECT ARRAY(
    SELECT DISTINCT required.capability
    FROM (
      SELECT 'platform:admin'::text AS capability
      UNION ALL
      SELECT CASE change ->> 'operation'
        WHEN 'save-platform-settings' THEN 'platform:admin'
        WHEN 'set-provider-routing' THEN 'provider:manage'
        WHEN 'publish-price-rate' THEN 'provider:manage'
        ELSE 'invalid:platform-change'
      END AS capability
      FROM jsonb_array_elements(p_changes) AS staged(change)
    ) AS required
    ORDER BY capability
  )
$function$;

CREATE FUNCTION review_operator_has_all_platform_capabilities(
  p_capabilities text[]
) RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $function$
  SELECT cardinality(p_capabilities) > 0
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(p_capabilities) AS required(capability)
      WHERE NOT review_operator_has_platform_capability(required.capability)
    )
$function$;

REVOKE ALL ON FUNCTION platform_configuration_required_capabilities(jsonb)
FROM PUBLIC, context_svc, context_runtime_svc, console_control_svc, generation_svc;
REVOKE ALL ON FUNCTION review_operator_has_all_platform_capabilities(text[])
FROM PUBLIC, context_svc, context_runtime_svc, generation_svc;
GRANT EXECUTE ON FUNCTION platform_configuration_required_capabilities(jsonb)
TO console_control_svc;
GRANT EXECUTE ON FUNCTION review_operator_has_all_platform_capabilities(text[])
TO console_control_svc;

-- A Platform publication materializes every active Tenant/Location snapshot,
-- so a Platform admin must be able to read the already-deployed Prompt bound
-- into each snapshot. Undeployed Draft Prompt bodies remain hidden, and no
-- Prompt mutation capability is broadened.
DROP POLICY operator_or_service_read_policy ON prompt_deployments;
CREATE POLICY operator_or_service_read_policy ON prompt_deployments
  FOR SELECT
  USING (
    (
      current_user IN ('context_runtime_svc', 'context_svc')
      AND NULLIF(current_setting('app.operator_id', true), '') IS NULL
      AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    ) OR review_operator_has_tenant_capability(tenant_id, 'ai:operate')
      OR review_operator_has_tenant_capability(tenant_id, 'tenant:configure')
      OR review_operator_has_platform_capability('platform:admin')
  );

DROP POLICY operator_or_service_read_policy ON prompt_versions;
CREATE POLICY operator_or_service_read_policy ON prompt_versions
  FOR SELECT
  USING (
    (
      current_user IN ('context_runtime_svc', 'context_svc')
      AND NULLIF(current_setting('app.operator_id', true), '') IS NULL
      AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    ) OR review_operator_has_tenant_capability(tenant_id, 'ai:operate')
      OR review_operator_has_tenant_capability(tenant_id, 'tenant:configure')
      OR (
        review_operator_has_platform_capability('platform:admin')
        AND EXISTS (
          SELECT 1
          FROM prompt_deployments AS deployed
          WHERE deployed.tenant_id = prompt_versions.tenant_id
            AND deployed.prompt_version_id = prompt_versions.id
        )
      )
  );

CREATE TABLE platform_configuration_states (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  published_revision bigint NOT NULL DEFAULT 1 CHECK (published_revision > 0),
  updated_at timestamptz(6) NOT NULL DEFAULT clock_timestamp()
);

INSERT INTO platform_configuration_states (singleton, published_revision)
SELECT true, COALESCE(config_revision, 1)
FROM platform_settings
WHERE id = 'platform'
ON CONFLICT (singleton) DO NOTHING;

INSERT INTO platform_configuration_states (singleton, published_revision)
VALUES (true, 1)
ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE platform_configuration_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton boolean NOT NULL DEFAULT true UNIQUE CHECK (singleton),
  base_revision bigint NOT NULL CHECK (base_revision > 0),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  changes jsonb NOT NULL CHECK (
    jsonb_typeof(changes) = 'array'
    AND jsonb_array_length(changes) > 0
  ),
  required_capabilities text[] GENERATED ALWAYS AS (
    platform_configuration_required_capabilities(changes)
  ) STORED,
  created_by uuid NOT NULL REFERENCES operators(id) ON DELETE RESTRICT,
  created_at timestamptz(6) NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz(6) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT platform_configuration_drafts_known_operations CHECK (
    required_capabilities <@ ARRAY['platform:admin', 'provider:manage']::text[]
  )
);

CREATE TABLE platform_configuration_publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  published_revision bigint NOT NULL UNIQUE CHECK (published_revision > 0),
  draft_id uuid NOT NULL,
  draft_revision bigint NOT NULL CHECK (draft_revision > 0),
  changes jsonb NOT NULL CHECK (
    jsonb_typeof(changes) = 'array'
    AND jsonb_array_length(changes) > 0
  ),
  required_capabilities text[] GENERATED ALWAYS AS (
    platform_configuration_required_capabilities(changes)
  ) STORED,
  snapshot_ids uuid[] NOT NULL DEFAULT '{}',
  actor_id uuid NOT NULL REFERENCES operators(id) ON DELETE RESTRICT,
  published_at timestamptz(6) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT platform_configuration_publications_draft_version_unique
    UNIQUE (draft_id, draft_revision),
  CONSTRAINT platform_configuration_publications_known_operations CHECK (
    required_capabilities <@ ARRAY['platform:admin', 'provider:manage']::text[]
  )
);

ALTER TABLE platform_configuration_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_configuration_states FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_configuration_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_configuration_drafts FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_configuration_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_configuration_publications FORCE ROW LEVEL SECURITY;

CREATE POLICY platform_configuration_state_read_policy
ON platform_configuration_states FOR SELECT
USING (
  review_operator_has_platform_capability('platform:admin')
  OR review_operator_has_platform_capability('provider:manage')
);

CREATE POLICY platform_configuration_state_update_policy
ON platform_configuration_states FOR UPDATE
USING (
  review_operator_has_platform_capability('platform:admin')
  OR review_operator_has_platform_capability('provider:manage')
)
WITH CHECK (
  review_operator_has_platform_capability('platform:admin')
  OR review_operator_has_platform_capability('provider:manage')
);

CREATE POLICY platform_configuration_draft_read_policy
ON platform_configuration_drafts FOR SELECT
USING (review_operator_has_all_platform_capabilities(required_capabilities));
CREATE POLICY platform_configuration_draft_insert_policy
ON platform_configuration_drafts FOR INSERT
WITH CHECK (review_operator_has_all_platform_capabilities(required_capabilities));
CREATE POLICY platform_configuration_draft_update_policy
ON platform_configuration_drafts FOR UPDATE
USING (review_operator_has_all_platform_capabilities(required_capabilities))
WITH CHECK (review_operator_has_all_platform_capabilities(required_capabilities));
CREATE POLICY platform_configuration_draft_delete_policy
ON platform_configuration_drafts FOR DELETE
USING (review_operator_has_all_platform_capabilities(required_capabilities));

CREATE POLICY platform_configuration_publication_read_policy
ON platform_configuration_publications FOR SELECT
USING (review_operator_has_all_platform_capabilities(required_capabilities));
CREATE POLICY platform_configuration_publication_insert_policy
ON platform_configuration_publications FOR INSERT
WITH CHECK (review_operator_has_all_platform_capabilities(required_capabilities));

DO $migration_owner_policy$
DECLARE
  migration_owner name;
  table_name text;
BEGIN
  SELECT role.rolname
  INTO STRICT migration_owner
  FROM pg_class AS class
  JOIN pg_roles AS role ON role.oid = class.relowner
  WHERE class.oid = 'platform_configuration_states'::regclass;

  FOREACH table_name IN ARRAY ARRAY[
    'platform_configuration_states',
    'platform_configuration_drafts',
    'platform_configuration_publications'
  ]
  LOOP
    EXECUTE format(
      'CREATE POLICY migration_owner_maintenance_policy ON %I FOR ALL TO %I USING (current_user = %L) WITH CHECK (current_user = %L)',
      table_name,
      migration_owner,
      migration_owner,
      migration_owner
    );
  END LOOP;
END
$migration_owner_policy$;

CREATE TRIGGER platform_configuration_publications_append_only
BEFORE UPDATE OR DELETE ON platform_configuration_publications
FOR EACH ROW
EXECUTE FUNCTION reject_published_configuration_mutation();

REVOKE ALL ON platform_configuration_drafts, platform_configuration_publications
FROM PUBLIC, context_runtime_svc, generation_svc;
REVOKE ALL ON platform_configuration_states
FROM PUBLIC, context_svc, context_runtime_svc, generation_svc;
REVOKE ALL ON platform_configuration_drafts, platform_configuration_publications
FROM context_svc;

GRANT SELECT, UPDATE ON platform_configuration_states TO console_control_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform_configuration_drafts
TO console_control_svc;
GRANT SELECT, INSERT ON platform_configuration_publications
TO console_control_svc;
REVOKE UPDATE, DELETE, TRUNCATE ON platform_configuration_publications
FROM console_control_svc;

-- The adapter validates the same rule before producing useful errors. This is
-- the final guard against concurrent or ad-hoc overlapping Price Rate writes.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE price_rates
  ADD CONSTRAINT price_rates_effective_period_non_overlapping
  EXCLUDE USING gist (
    provider_model_id WITH =,
    tstzrange(effective_from, effective_to, '[)') WITH &&
  );
