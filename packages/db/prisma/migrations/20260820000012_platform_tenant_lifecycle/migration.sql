-- Provisioning an account from the Console was impossible: the tenants policy
-- allowed a Platform administrator to read every Tenant but checked writes
-- against app.tenant_id, which Platform scope deliberately does not set. Every
-- INSERT was therefore rejected by Row-Level Security before it began, and the
-- same held for suspending or reactivating an account.
--
-- Reads are unchanged. Writes now accept either the Tenant acting on itself or
-- a current Platform Grant, which is the same authority the read side already
-- recognised.

DROP POLICY operator_or_tenant_policy ON tenants;

CREATE POLICY operator_or_tenant_read_policy ON tenants
  FOR SELECT
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
  );

CREATE POLICY platform_tenant_insert_policy ON tenants
  FOR INSERT
  WITH CHECK (
    id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR
    EXISTS (
      SELECT 1
      FROM platform_access_grants AS platform_grant
      WHERE platform_grant.operator_id = NULLIF(current_setting('app.operator_id', true), '')::uuid
        AND platform_grant.status = 'ACTIVE'
        AND platform_grant.valid_from <= clock_timestamp()
        AND (platform_grant.valid_until IS NULL OR platform_grant.valid_until > clock_timestamp())
    )
  );

CREATE POLICY platform_tenant_update_policy ON tenants
  FOR UPDATE
  USING (
    id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR
    EXISTS (
      SELECT 1
      FROM platform_access_grants AS platform_grant
      WHERE platform_grant.operator_id = NULLIF(current_setting('app.operator_id', true), '')::uuid
        AND platform_grant.status = 'ACTIVE'
        AND platform_grant.valid_from <= clock_timestamp()
        AND (platform_grant.valid_until IS NULL OR platform_grant.valid_until > clock_timestamp())
    )
  )
  WITH CHECK (
    id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR
    EXISTS (
      SELECT 1
      FROM platform_access_grants AS platform_grant
      WHERE platform_grant.operator_id = NULLIF(current_setting('app.operator_id', true), '')::uuid
        AND platform_grant.status = 'ACTIVE'
        AND platform_grant.valid_from <= clock_timestamp()
        AND (platform_grant.valid_until IS NULL OR platform_grant.valid_until > clock_timestamp())
    )
  );

-- No DELETE policy is granted. Locations, Review Sessions and Generations all
-- reference a Tenant with ON DELETE RESTRICT, so removing one would either
-- fail or destroy the audit trail an operator may later need. An account is
-- suspended or deactivated instead, which stops all reviewer entry while the
-- record stays reconstructable.
