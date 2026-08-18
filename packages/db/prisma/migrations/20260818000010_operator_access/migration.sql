-- US-04.1: bind trusted OIDC identities to provisioned Operators and make
-- current Access Grants the sole authority for Console scope.

ALTER TABLE operators
  ADD COLUMN external_issuer varchar(500);

UPDATE operators
SET external_issuer = 'urn:review:legacy-identity'
WHERE external_subject IS NOT NULL;

ALTER TABLE operators
  DROP CONSTRAINT IF EXISTS operators_external_subject_key,
  DROP CONSTRAINT operators_auth_identity_present,
  ADD CONSTRAINT operators_external_identity_shape CHECK (
    (external_issuer IS NULL AND external_subject IS NULL) OR
    (external_issuer IS NOT NULL AND external_subject IS NOT NULL)
  ),
  ADD CONSTRAINT operators_external_identity_unique
    UNIQUE (external_issuer, external_subject);

CREATE TABLE platform_access_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid NOT NULL,
  role_key varchar(80) NOT NULL,
  status grant_status NOT NULL DEFAULT 'ACTIVE',
  is_break_glass boolean NOT NULL DEFAULT false,
  valid_from timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  valid_until timestamptz(6),
  revoked_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT platform_access_grants_identity_unique UNIQUE (operator_id, role_key),
  CONSTRAINT platform_access_grants_interval CHECK (valid_until IS NULL OR valid_until > valid_from),
  CONSTRAINT platform_access_grants_revocation_shape CHECK (
    (status = 'ACTIVE' AND revoked_at IS NULL) OR
    (status = 'REVOKED' AND revoked_at IS NOT NULL)
  ),
  CONSTRAINT platform_access_grants_operator_fk
    FOREIGN KEY (operator_id) REFERENCES operators(id) ON DELETE RESTRICT,
  CONSTRAINT platform_access_grants_role_fk
    FOREIGN KEY (role_key) REFERENCES operator_role_definitions(key) ON DELETE RESTRICT
);

CREATE INDEX platform_access_grants_operator_idx
  ON platform_access_grants (operator_id);

-- Operator-scoped RLS is an alternate authorized session context for Console
-- reads. Reviewer/service paths continue to set only app.tenant_id.
DROP POLICY tenant_isolation_policy ON tenant_access_grants;
CREATE POLICY operator_or_tenant_grant_policy ON tenant_access_grants
  FOR ALL
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR
    operator_id = NULLIF(current_setting('app.operator_id', true), '')::uuid OR
    EXISTS (
      SELECT 1
      FROM platform_access_grants AS platform_grant
      WHERE platform_grant.operator_id = NULLIF(current_setting('app.operator_id', true), '')::uuid
        AND platform_grant.status = 'ACTIVE'
        AND platform_grant.valid_from <= clock_timestamp()
        AND (platform_grant.valid_until IS NULL OR platform_grant.valid_until > clock_timestamp())
    )
  )
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY tenant_isolation_policy ON tenants;
CREATE POLICY operator_or_tenant_policy ON tenants
  FOR ALL
  USING (
    id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR
    EXISTS (
      SELECT 1
      FROM tenant_access_grants AS access_grant
      WHERE access_grant.tenant_id = tenants.id
        AND access_grant.operator_id = NULLIF(current_setting('app.operator_id', true), '')::uuid
        AND access_grant.status = 'ACTIVE'
        AND access_grant.valid_from <= clock_timestamp()
        AND (access_grant.valid_until IS NULL OR access_grant.valid_until > clock_timestamp())
    ) OR
    EXISTS (
      SELECT 1
      FROM platform_access_grants AS platform_grant
      WHERE platform_grant.operator_id = NULLIF(current_setting('app.operator_id', true), '')::uuid
        AND platform_grant.status = 'ACTIVE'
        AND platform_grant.valid_from <= clock_timestamp()
        AND (platform_grant.valid_until IS NULL OR platform_grant.valid_until > clock_timestamp())
    )
  )
  WITH CHECK (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY tenant_isolation_policy ON locations;
CREATE POLICY operator_or_tenant_location_policy ON locations
  FOR SELECT
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR
    EXISTS (
      SELECT 1
      FROM tenant_access_grants AS access_grant
      WHERE access_grant.tenant_id = locations.tenant_id
        AND access_grant.operator_id = NULLIF(current_setting('app.operator_id', true), '')::uuid
        AND access_grant.status = 'ACTIVE'
        AND access_grant.valid_from <= clock_timestamp()
        AND (access_grant.valid_until IS NULL OR access_grant.valid_until > clock_timestamp())
    ) OR
    EXISTS (
      SELECT 1
      FROM platform_access_grants AS platform_grant
      WHERE platform_grant.operator_id = NULLIF(current_setting('app.operator_id', true), '')::uuid
        AND platform_grant.status = 'ACTIVE'
        AND platform_grant.valid_from <= clock_timestamp()
        AND (platform_grant.valid_until IS NULL OR platform_grant.valid_until > clock_timestamp())
    )
  );
CREATE POLICY tenant_location_write_policy ON locations
  FOR INSERT
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY tenant_location_update_policy ON locations
  FOR UPDATE
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY tenant_location_delete_policy ON locations
  FOR DELETE
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, UPDATE ON operators TO context_svc;
GRANT SELECT, INSERT, UPDATE ON platform_access_grants TO context_svc;
