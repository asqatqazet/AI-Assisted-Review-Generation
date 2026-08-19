-- EP-04: the three things the Console control plane needs that the schema did
-- not yet carry, plus the writes an operator is allowed to make.

-- 1. Versioned business context (ADM-CFG-01).
--    Publishing appends a version. context_svc deliberately receives no UPDATE
--    or DELETE grant, so a published version cannot be rewritten and an old
--    Generation can always resolve the context it was grounded on.
CREATE TABLE tenant_context_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  version integer NOT NULL,
  context text NOT NULL,
  banned_terms text[] NOT NULL DEFAULT '{}',
  created_by uuid,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT tenant_context_versions_identity UNIQUE (tenant_id, version),
  CONSTRAINT tenant_context_versions_version_positive CHECK (version >= 1),
  CONSTRAINT tenant_context_versions_tenant_fk
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CONSTRAINT tenant_context_versions_author_fk
    FOREIGN KEY (created_by) REFERENCES operators(id) ON DELETE RESTRICT
);

CREATE INDEX tenant_context_versions_tenant_idx
  ON tenant_context_versions (tenant_id, version DESC);

ALTER TABLE tenant_context_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_context_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON tenant_context_versions
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT ON tenant_context_versions TO context_svc;

-- 2. Prompt versions carry their own ordinal, lifecycle and evaluation score
--    (ADM-AI-01). The content hash already made them immutable; these make the
--    history legible to an operator.
CREATE TYPE prompt_version_status AS ENUM (
  'DRAFT',
  'CANDIDATE',
  'IN_EXPERIMENT',
  'RETIRED'
);

ALTER TABLE prompt_versions
  ADD COLUMN version integer,
  ADD COLUMN status prompt_version_status NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN evaluation_score numeric(5, 4),
  ADD COLUMN created_by uuid;

WITH ordered AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY tenant_id, action ORDER BY created_at, id
    ) AS ordinal
  FROM prompt_versions
)
UPDATE prompt_versions
SET version = ordered.ordinal
FROM ordered
WHERE prompt_versions.id = ordered.id;

ALTER TABLE prompt_versions
  ALTER COLUMN version SET NOT NULL,
  ADD CONSTRAINT prompt_versions_version_positive CHECK (version >= 1),
  ADD CONSTRAINT prompt_versions_evaluation_range CHECK (
    evaluation_score IS NULL OR
    (evaluation_score >= 0 AND evaluation_score <= 1)
  ),
  ADD CONSTRAINT prompt_versions_ordinal_unique UNIQUE (tenant_id, action, version),
  ADD CONSTRAINT prompt_versions_author_fk
    FOREIGN KEY (created_by) REFERENCES operators(id) ON DELETE RESTRICT;

-- 3. Provider routing is explicit rather than inferred from two booleans
--    (ADM-PLT-02). The survey never chooses a provider; this is the only place
--    the order is decided.
ALTER TABLE provider_models
  ADD COLUMN routing_priority integer,
  ADD COLUMN fallback_priority integer,
  ADD CONSTRAINT provider_models_routing_priority_positive CHECK (
    routing_priority IS NULL OR routing_priority >= 1
  ),
  ADD CONSTRAINT provider_models_fallback_priority_positive CHECK (
    fallback_priority IS NULL OR fallback_priority >= 1
  );

UPDATE provider_models
SET routing_priority = 1
FROM providers
WHERE providers.id = provider_models.provider_id
  AND providers.is_default;

UPDATE provider_models
SET fallback_priority = 1
FROM providers
WHERE providers.id = provider_models.provider_id
  AND providers.is_fallback;

-- 4. Platform-scope writes an authorized operator performs. Reviewer paths are
--    unaffected: these tables stay read-only to generation_svc.
GRANT INSERT, UPDATE ON platform_settings TO context_svc;
GRANT INSERT, UPDATE ON feature_flags TO context_svc;
GRANT INSERT, UPDATE ON provider_models TO context_svc;
GRANT INSERT, UPDATE ON price_rates TO context_svc;
GRANT INSERT, UPDATE ON review_format_versions TO context_svc;
GRANT INSERT ON posting_destination_types TO context_svc;

-- 5. Platform scope has no single Tenant to set, so a Platform administrator
--    reading month-to-date spend would otherwise match no rows at all and see
--    every account as having spent nothing. Reads widen to a current Platform
--    Grant; writes stay bound to the Tenant that owns the reservation.
DROP POLICY tenant_isolation_policy ON budget_reservations;

CREATE POLICY operator_or_tenant_budget_read_policy ON budget_reservations
  FOR SELECT
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR
    EXISTS (
      SELECT 1
      FROM platform_access_grants AS platform_grant
      WHERE platform_grant.operator_id = NULLIF(current_setting('app.operator_id', true), '')::uuid
        AND platform_grant.status = 'ACTIVE'
        AND platform_grant.valid_from <= clock_timestamp()
        AND (platform_grant.valid_until IS NULL OR platform_grant.valid_until > clock_timestamp())
    )
  );

CREATE POLICY tenant_budget_insert_policy ON budget_reservations
  FOR INSERT
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY tenant_budget_update_policy ON budget_reservations
  FOR UPDATE
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY tenant_budget_delete_policy ON budget_reservations
  FOR DELETE
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
