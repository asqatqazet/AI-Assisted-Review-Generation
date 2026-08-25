-- US-04.1 / US-05.1: make the database independently verify current Operator,
-- Access Grant, Role Definition and Capability instead of trusting that the
-- Console handler selected the right scope.

-- The reviewer runtime and Operator Console are different trust domains even
-- though the previous release hosted them in one Context Lambda. New versions
-- choose one of these non-inheriting roles through a sealed connection URL;
-- the historical shared login remains only for the bounded rollback bridge.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_roles WHERE rolname = 'context_runtime_svc'
  ) THEN
    CREATE ROLE context_runtime_svc WITH LOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (
    SELECT FROM pg_roles WHERE rolname = 'console_control_svc'
  ) THEN
    CREATE ROLE console_control_svc WITH LOGIN NOINHERIT;
  END IF;
END $$;

ALTER ROLE context_runtime_svc NOINHERIT;
ALTER ROLE console_control_svc NOINHERIT;
-- Expand phase: the already-published combined Context Lambda still resolves
-- its sealed context_svc URL if an alias rollback is required. Keep only that
-- historical login/grant surface until a later contract migration; all new
-- reviewer and Console versions use the split roles above.
ALTER ROLE context_svc LOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;

GRANT USAGE ON SCHEMA public TO context_runtime_svc, console_control_svc;

-- Reviewer entry, session and Generation admission. The runtime can resolve
-- immutable configuration and mutate reviewer-owned operational rows, but it
-- cannot read or mutate Operators or Access Grants.
GRANT SELECT ON
  platform_settings, providers, provider_models, price_rates, feature_flags,
  action_definitions, review_format_versions, posting_destination_types,
  entry_mode_definitions, prompt_template_versions,
  tenants, tenant_action_enablements, locations, posting_destination_bindings,
  fact_option_categories, fact_option_versions, review_format_enablements,
  prompt_versions, experiments, experiment_variants,
  effective_configuration_snapshots, tenant_context_versions,
  drafts, draft_revisions
TO context_runtime_svc;
GRANT SELECT, INSERT, UPDATE ON
  visits, invitation_tokens, review_sessions, review_session_browser_bindings,
  entry_challenges, source_text_revisions, assertions, budget_reservations,
  generation_batches, generation_batch_assertions
TO context_runtime_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON reconciliation_queue_items
TO context_runtime_svc;
GRANT EXECUTE ON FUNCTION prepare_entry_challenge(
  varchar, varchar, varchar, varchar, varchar, varchar, timestamptz
) TO context_runtime_svc;
GRANT EXECUTE ON FUNCTION resolve_live_entry_challenge(varchar, varchar)
TO context_runtime_svc;
GRANT EXECUTE ON FUNCTION touch_live_review_session_browser_binding(
  varchar, varchar
) TO context_runtime_svc;
GRANT EXECUTE ON FUNCTION claim_platform_generation_capacity(uuid, boolean)
TO context_runtime_svc;
GRANT EXECUTE ON FUNCTION release_platform_generation_capacity(uuid)
TO context_runtime_svc;

-- Console control plane. It can see operational counts, not Generation output,
-- and every Tenant/platform mutation below is still capability-gated by RLS.
GRANT SELECT ON
  platform_settings, providers, provider_models, price_rates, feature_flags,
  action_definitions, review_format_versions, posting_destination_types,
  entry_mode_definitions, operator_role_definitions, prompt_template_versions,
  tenants, tenant_access_grants, tenant_action_enablements, locations,
  posting_destination_bindings, fact_option_categories, fact_option_versions,
  review_format_enablements, prompt_versions, prompt_deployments, experiments,
  experiment_variants, effective_configuration_snapshots,
  tenant_context_versions, configuration_drafts, configuration_audit_events,
  visits, invitation_tokens, review_sessions, entry_challenges,
  source_text_revisions, assertions, budget_reservations, generation_batches,
  generation_batch_assertions, platform_access_grants, operators
TO console_control_svc;
GRANT INSERT, UPDATE ON
  tenants, tenant_access_grants, tenant_action_enablements, locations,
  posting_destination_bindings, fact_option_categories, fact_option_versions,
  review_format_enablements, prompt_deployments, experiments,
  experiment_variants,
  platform_access_grants
TO console_control_svc;
GRANT INSERT ON prompt_versions, effective_configuration_snapshots
TO console_control_svc;
REVOKE UPDATE, DELETE, TRUNCATE ON
  prompt_versions, effective_configuration_snapshots
FROM console_control_svc;
GRANT INSERT ON tenant_context_versions, configuration_audit_events
TO console_control_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON configuration_drafts
TO console_control_svc;
GRANT UPDATE ON operators TO console_control_svc;
GRANT INSERT, UPDATE ON
  platform_settings, feature_flags, provider_models, price_rates,
  review_format_versions
TO console_control_svc;
GRANT INSERT ON posting_destination_types TO console_control_svc;

CREATE FUNCTION review_operator_has_tenant_capability_privileged(
  target_tenant_id uuid,
  required_capability text
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenant_access_grants AS access_grant
    JOIN public.operators AS operator
      ON operator.id = access_grant.operator_id
    JOIN public.operator_role_definitions AS role
      ON role.key = access_grant.role_key
    WHERE access_grant.tenant_id = target_tenant_id
      AND access_grant.operator_id = NULLIF(current_setting('app.operator_id', true), '')::uuid
      AND access_grant.status = 'ACTIVE'
      AND access_grant.valid_from <= clock_timestamp()
      AND (access_grant.valid_until IS NULL OR access_grant.valid_until > clock_timestamp())
      AND operator.status = 'ACTIVE'
      AND role.status = 'ACTIVE'
      AND required_capability = ANY(role.capabilities)
  ) OR EXISTS (
    SELECT 1
    FROM public.platform_access_grants AS platform_grant
    JOIN public.operators AS operator
      ON operator.id = platform_grant.operator_id
    JOIN public.operator_role_definitions AS role
      ON role.key = platform_grant.role_key
    WHERE platform_grant.operator_id = NULLIF(current_setting('app.operator_id', true), '')::uuid
      AND platform_grant.status = 'ACTIVE'
      AND platform_grant.valid_from <= clock_timestamp()
      AND (platform_grant.valid_until IS NULL OR platform_grant.valid_until > clock_timestamp())
      AND operator.status = 'ACTIVE'
      AND role.status = 'ACTIVE'
      AND required_capability = ANY(role.capabilities)
  );
$$;

CREATE FUNCTION review_operator_has_platform_capability_privileged(
  required_capability text
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.platform_access_grants AS platform_grant
    JOIN public.operators AS operator
      ON operator.id = platform_grant.operator_id
    JOIN public.operator_role_definitions AS role
      ON role.key = platform_grant.role_key
    WHERE platform_grant.operator_id = NULLIF(current_setting('app.operator_id', true), '')::uuid
      AND platform_grant.status = 'ACTIVE'
      AND platform_grant.valid_from <= clock_timestamp()
      AND (platform_grant.valid_until IS NULL OR platform_grant.valid_until > clock_timestamp())
      AND operator.status = 'ACTIVE'
      AND role.status = 'ACTIVE'
      AND required_capability = ANY(role.capabilities)
  );
$$;

-- RLS expressions are privilege-checked even when the runtime branch would
-- make the Operator branch false. These invoker wrappers are executable by
-- both roles, but only the Console role can cross into the privileged reader.
-- The runtime therefore gets a deterministic false without a grant-metadata
-- oracle; the privileged functions remain unreachable to it.
CREATE FUNCTION review_operator_has_tenant_capability(
  target_tenant_id uuid,
  required_capability text
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF current_user NOT IN ('console_control_svc', 'context_svc') THEN
    RETURN false;
  END IF;
  RETURN review_operator_has_tenant_capability_privileged(
    target_tenant_id,
    required_capability
  );
END;
$$;

CREATE FUNCTION review_operator_has_platform_capability(
  required_capability text
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF current_user NOT IN ('console_control_svc', 'context_svc') THEN
    RETURN false;
  END IF;
  RETURN review_operator_has_platform_capability_privileged(
    required_capability
  );
END;
$$;

REVOKE ALL ON FUNCTION review_operator_has_tenant_capability_privileged(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION review_operator_has_platform_capability_privileged(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION review_operator_has_tenant_capability(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION review_operator_has_platform_capability(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION review_operator_has_tenant_capability_privileged(uuid, text)
TO console_control_svc, context_svc;
GRANT EXECUTE ON FUNCTION review_operator_has_platform_capability_privileged(text)
TO console_control_svc, context_svc;
GRANT EXECUTE ON FUNCTION review_operator_has_tenant_capability(uuid, text)
TO context_runtime_svc, console_control_svc, context_svc;
GRANT EXECUTE ON FUNCTION review_operator_has_platform_capability(text)
TO context_runtime_svc, console_control_svc, context_svc;

-- Platform-owned policy and provider catalogues have no tenant_id, so their
-- database guard must distinguish the sealed runtime login from an Operator
-- session explicitly. A null Operator on the Console login matches neither
-- side and therefore cannot read or mutate these tables.
DO $$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT * FROM (VALUES
      ('platform_settings', 'platform:admin'),
      ('providers', 'provider:manage'),
      ('provider_models', 'provider:manage'),
      ('price_rates', 'provider:manage'),
      ('feature_flags', 'platform:admin'),
      ('action_definitions', 'platform:admin'),
      ('review_format_versions', 'platform:admin'),
      ('posting_destination_types', 'platform:admin')
    ) AS platform_policy(table_name, operator_capability)
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', item.table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', item.table_name);
    EXECUTE format(
      'CREATE POLICY runtime_or_operator_read_policy ON %I FOR SELECT USING (((current_user IN (''context_runtime_svc'', ''context_svc'')) AND NULLIF(current_setting(''app.operator_id'', true), '''') IS NULL) OR review_operator_has_platform_capability(%L) OR review_operator_has_tenant_capability(NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid, ''console:read''))',
      item.table_name,
      item.operator_capability
    );
    EXECUTE format(
      'CREATE POLICY operator_insert_policy ON %I FOR INSERT WITH CHECK (review_operator_has_platform_capability(%L))',
      item.table_name,
      item.operator_capability
    );
    EXECUTE format(
      'CREATE POLICY operator_update_policy ON %I FOR UPDATE USING (review_operator_has_platform_capability(%L)) WITH CHECK (review_operator_has_platform_capability(%L))',
      item.table_name,
      item.operator_capability,
      item.operator_capability
    );
    EXECUTE format(
      'CREATE POLICY operator_delete_policy ON %I FOR DELETE USING (review_operator_has_platform_capability(%L))',
      item.table_name,
      item.operator_capability
    );
  END LOOP;
END $$;

DROP POLICY operator_or_tenant_location_policy ON locations;
DROP POLICY tenant_location_write_policy ON locations;
DROP POLICY tenant_location_update_policy ON locations;
DROP POLICY tenant_location_delete_policy ON locations;

CREATE POLICY operator_or_service_location_read_policy ON locations
  FOR SELECT
  USING (
    (
      current_user IN ('context_runtime_svc', 'context_svc')
      AND NULLIF(current_setting('app.operator_id', true), '') IS NULL
      AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    ) OR review_operator_has_tenant_capability(tenant_id, 'console:read')
  );

CREATE POLICY operator_or_service_location_insert_policy ON locations
  FOR INSERT
  WITH CHECK (
    (
      current_user IN ('context_runtime_svc', 'context_svc')
      AND NULLIF(current_setting('app.operator_id', true), '') IS NULL
      AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    ) OR review_operator_has_tenant_capability(tenant_id, 'tenant:configure')
  );

CREATE POLICY operator_or_service_location_update_policy ON locations
  FOR UPDATE
  USING (
    (
      current_user IN ('context_runtime_svc', 'context_svc')
      AND NULLIF(current_setting('app.operator_id', true), '') IS NULL
      AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    ) OR review_operator_has_tenant_capability(tenant_id, 'tenant:configure')
  )
  WITH CHECK (
    (
      current_user IN ('context_runtime_svc', 'context_svc')
      AND NULLIF(current_setting('app.operator_id', true), '') IS NULL
      AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    ) OR review_operator_has_tenant_capability(tenant_id, 'tenant:configure')
  );

CREATE POLICY operator_or_service_location_delete_policy ON locations
  FOR DELETE
  USING (
    (
      current_user IN ('context_runtime_svc', 'context_svc')
      AND NULLIF(current_setting('app.operator_id', true), '') IS NULL
      AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    ) OR review_operator_has_tenant_capability(tenant_id, 'tenant:configure')
  );

-- Tenant roots distinguish ordinary Context work (no Operator session) from a
-- Console request. A Console request cannot turn a browser-selected Tenant id
-- into authority merely by setting app.tenant_id.
DROP POLICY operator_or_tenant_read_policy ON tenants;
DROP POLICY platform_tenant_insert_policy ON tenants;
DROP POLICY platform_tenant_update_policy ON tenants;

CREATE POLICY operator_or_service_tenant_read_policy ON tenants
  FOR SELECT
  USING (
    (
      current_user IN ('context_runtime_svc', 'context_svc')
      AND NULLIF(current_setting('app.operator_id', true), '') IS NULL
      AND id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    ) OR review_operator_has_tenant_capability(id, 'console:read')
  );

CREATE POLICY operator_or_service_tenant_insert_policy ON tenants
  FOR INSERT
  WITH CHECK (
    (
      current_user IN ('context_runtime_svc', 'context_svc')
      AND NULLIF(current_setting('app.operator_id', true), '') IS NULL
      AND id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    ) OR review_operator_has_platform_capability('platform:admin')
  );

CREATE POLICY operator_or_service_tenant_update_policy ON tenants
  FOR UPDATE
  USING (
    (
      current_user IN ('context_runtime_svc', 'context_svc')
      AND NULLIF(current_setting('app.operator_id', true), '') IS NULL
      AND id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    ) OR review_operator_has_tenant_capability(id, 'tenant:configure')
      OR review_operator_has_platform_capability('platform:admin')
  )
  WITH CHECK (
    (
      current_user IN ('context_runtime_svc', 'context_svc')
      AND NULLIF(current_setting('app.operator_id', true), '') IS NULL
      AND id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    ) OR review_operator_has_tenant_capability(id, 'tenant:configure')
      OR review_operator_has_platform_capability('platform:admin')
  );

-- Configuration tables use the capability that owns their public Console
-- command. Normal Context service work keeps its tenant-bound path only when
-- no Operator session is present.
DO $$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT * FROM (VALUES
      ('tenant_action_enablements', 'console:read', 'tenant:configure'),
      ('posting_destination_bindings', 'console:read', 'tenant:configure'),
      ('fact_option_categories', 'console:read', 'tenant:configure'),
      ('fact_option_versions', 'console:read', 'tenant:configure'),
      ('review_format_enablements', 'console:read', 'tenant:configure'),
      ('effective_configuration_snapshots', 'console:read', 'tenant:configure'),
      ('tenant_context_versions', 'console:read', 'tenant:configure'),
      ('prompt_versions', 'ai:operate', 'ai:operate'),
      ('prompt_deployments', 'ai:operate', 'ai:operate'),
      ('configuration_drafts', 'console:read', 'tenant:configure'),
      ('configuration_audit_events', 'console:read', 'tenant:configure'),
      ('experiments', 'ai:operate', 'ai:operate'),
      ('experiment_variants', 'ai:operate', 'ai:operate')
    ) AS capability_policy(table_name, read_capability, write_capability)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_policy ON %I', item.table_name);
    EXECUTE format(
      'CREATE POLICY operator_or_service_read_policy ON %I FOR SELECT USING (((current_user IN (''context_runtime_svc'', ''context_svc'') AND NULLIF(current_setting(''app.operator_id'', true), '''') IS NULL) AND tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) OR review_operator_has_tenant_capability(tenant_id, %L))',
      item.table_name,
      item.read_capability
    );
    EXECUTE format(
      'CREATE POLICY operator_or_service_insert_policy ON %I FOR INSERT WITH CHECK (((current_user IN (''context_runtime_svc'', ''context_svc'') AND NULLIF(current_setting(''app.operator_id'', true), '''') IS NULL) AND tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) OR review_operator_has_tenant_capability(tenant_id, %L) OR review_operator_has_platform_capability(''platform:admin''))',
      item.table_name,
      item.write_capability
    );
    EXECUTE format(
      'CREATE POLICY operator_or_service_update_policy ON %I FOR UPDATE USING (((current_user IN (''context_runtime_svc'', ''context_svc'') AND NULLIF(current_setting(''app.operator_id'', true), '''') IS NULL) AND tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) OR review_operator_has_tenant_capability(tenant_id, %L) OR review_operator_has_platform_capability(''platform:admin'')) WITH CHECK (((current_user IN (''context_runtime_svc'', ''context_svc'') AND NULLIF(current_setting(''app.operator_id'', true), '''') IS NULL) AND tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) OR review_operator_has_tenant_capability(tenant_id, %L) OR review_operator_has_platform_capability(''platform:admin''))',
      item.table_name,
      item.write_capability,
      item.write_capability
    );
    EXECUTE format(
      'CREATE POLICY operator_or_service_delete_policy ON %I FOR DELETE USING (((current_user IN (''context_runtime_svc'', ''context_svc'') AND NULLIF(current_setting(''app.operator_id'', true), '''') IS NULL) AND tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) OR review_operator_has_tenant_capability(tenant_id, %L) OR review_operator_has_platform_capability(''platform:admin''))',
      item.table_name,
      item.write_capability
    );
  END LOOP;
END $$;

-- Publishing general Tenant configuration must be able to embed the already
-- deployed Prompt in an immutable snapshot, while Prompt mutation remains an
-- ai:operate capability. A Tenant viewer has neither write capability and
-- therefore still cannot read Prompt bodies through the database role.
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
  );

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
  );

-- Operational rows are readable only where a Console projection currently
-- needs scoped counts. No Operator capability authorizes mutation of reviewer
-- sessions or their evidence through this control-plane connection.
DO $$
DECLARE
  table_name text;
  operational_tables text[] := ARRAY[
    'visits',
    'invitation_tokens',
    'review_sessions',
    'entry_challenges',
    'source_text_revisions',
    'assertions',
    'experiment_assignments',
    'generation_batches',
    'generation_batch_assertions'
  ];
BEGIN
  FOREACH table_name IN ARRAY operational_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_policy ON %I', table_name);
    EXECUTE format(
      'CREATE POLICY operator_or_service_read_policy ON %I FOR SELECT USING (((current_user IN (''context_runtime_svc'', ''context_svc'') AND NULLIF(current_setting(''app.operator_id'', true), '''') IS NULL) AND tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) OR review_operator_has_tenant_capability(tenant_id, ''console:read''))',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY service_insert_policy ON %I FOR INSERT WITH CHECK ((current_user IN (''context_runtime_svc'', ''context_svc'') AND NULLIF(current_setting(''app.operator_id'', true), '''') IS NULL) AND tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY service_update_policy ON %I FOR UPDATE USING ((current_user IN (''context_runtime_svc'', ''context_svc'') AND NULLIF(current_setting(''app.operator_id'', true), '''') IS NULL) AND tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK ((current_user IN (''context_runtime_svc'', ''context_svc'') AND NULLIF(current_setting(''app.operator_id'', true), '''') IS NULL) AND tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY service_delete_policy ON %I FOR DELETE USING ((current_user IN (''context_runtime_svc'', ''context_svc'') AND NULLIF(current_setting(''app.operator_id'', true), '''') IS NULL) AND tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
      table_name
    );
  END LOOP;
END $$;

DROP POLICY operator_or_tenant_budget_read_policy ON budget_reservations;
DROP POLICY tenant_budget_insert_policy ON budget_reservations;
DROP POLICY tenant_budget_update_policy ON budget_reservations;
DROP POLICY tenant_budget_delete_policy ON budget_reservations;

CREATE POLICY operator_or_service_budget_read_policy ON budget_reservations
  FOR SELECT
  USING (
    (
      current_user IN ('context_runtime_svc', 'context_svc')
      AND NULLIF(current_setting('app.operator_id', true), '') IS NULL
      AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    ) OR review_operator_has_tenant_capability(tenant_id, 'analytics:read')
      OR review_operator_has_platform_capability('analytics:read')
  );
CREATE POLICY service_budget_insert_policy ON budget_reservations
  FOR INSERT
  WITH CHECK (
    current_user IN ('context_runtime_svc', 'context_svc')
      AND NULLIF(current_setting('app.operator_id', true), '') IS NULL
    AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
CREATE POLICY service_budget_update_policy ON budget_reservations
  FOR UPDATE
  USING (
    current_user IN ('context_runtime_svc', 'context_svc')
      AND NULLIF(current_setting('app.operator_id', true), '') IS NULL
    AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    current_user IN ('context_runtime_svc', 'context_svc')
      AND NULLIF(current_setting('app.operator_id', true), '') IS NULL
    AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
CREATE POLICY service_budget_delete_policy ON budget_reservations
  FOR DELETE
  USING (
    current_user IN ('context_runtime_svc', 'context_svc')
      AND NULLIF(current_setting('app.operator_id', true), '') IS NULL
    AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

DROP POLICY operator_or_tenant_grant_policy ON tenant_access_grants;
CREATE POLICY own_or_service_tenant_grant_read_policy ON tenant_access_grants
  FOR SELECT
  USING (
    (
      current_user IN ('context_runtime_svc', 'context_svc')
      AND NULLIF(current_setting('app.operator_id', true), '') IS NULL
      AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    ) OR operator_id = NULLIF(current_setting('app.operator_id', true), '')::uuid
      OR review_operator_has_platform_capability('platform:admin')
  );
CREATE POLICY service_or_platform_tenant_grant_insert_policy ON tenant_access_grants
  FOR INSERT
  WITH CHECK (
    (
      current_user IN ('context_runtime_svc', 'context_svc')
      AND NULLIF(current_setting('app.operator_id', true), '') IS NULL
      AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    ) OR review_operator_has_platform_capability('platform:admin')
  );
CREATE POLICY service_or_platform_tenant_grant_update_policy ON tenant_access_grants
  FOR UPDATE
  USING (
    (
      current_user IN ('context_runtime_svc', 'context_svc')
      AND NULLIF(current_setting('app.operator_id', true), '') IS NULL
      AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    ) OR review_operator_has_platform_capability('platform:admin')
  )
  WITH CHECK (
    (
      current_user IN ('context_runtime_svc', 'context_svc')
      AND NULLIF(current_setting('app.operator_id', true), '') IS NULL
      AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    ) OR review_operator_has_platform_capability('platform:admin')
  );
CREATE POLICY service_or_platform_tenant_grant_delete_policy ON tenant_access_grants
  FOR DELETE
  USING (
    (
      current_user IN ('context_runtime_svc', 'context_svc')
      AND NULLIF(current_setting('app.operator_id', true), '') IS NULL
      AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    ) OR review_operator_has_platform_capability('platform:admin')
  );

ALTER TABLE platform_access_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_access_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY own_platform_grant_read_policy ON platform_access_grants
  FOR SELECT
  USING (
    operator_id = NULLIF(current_setting('app.operator_id', true), '')::uuid
    OR review_operator_has_platform_capability('platform:admin')
  );
CREATE POLICY platform_admin_grant_insert_policy ON platform_access_grants
  FOR INSERT
  WITH CHECK (review_operator_has_platform_capability('platform:admin'));
CREATE POLICY platform_admin_grant_update_policy ON platform_access_grants
  FOR UPDATE
  USING (review_operator_has_platform_capability('platform:admin'))
  WITH CHECK (review_operator_has_platform_capability('platform:admin'));
CREATE POLICY platform_admin_grant_delete_policy ON platform_access_grants
  FOR DELETE
  USING (review_operator_has_platform_capability('platform:admin'));

-- FORCE RLS must not blind the exact role that owns migrations. PostgreSQL
-- runs invariant triggers and the capability readers as that owner under
-- SECURITY DEFINER; without this narrowly targeted policy those functions see
-- an empty database when the managed-database owner lacks BYPASSRLS. The owner
-- can already alter these tables and policies, so this restores necessary
-- maintenance visibility without granting either application login authority.
DO $$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT
      class.relname AS table_name,
      role.rolname AS owner_name
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
    JOIN pg_catalog.pg_roles AS role
      ON class.relowner = role.oid
    WHERE namespace.nspname = 'public'
      AND class.relkind = 'r'
      AND class.relrowsecurity
      AND class.relforcerowsecurity
      AND role.rolname = current_user
  LOOP
    EXECUTE format(
      'CREATE POLICY migration_owner_maintenance_policy ON %I FOR ALL TO %I USING (current_user = %L) WITH CHECK (current_user = %L)',
      item.table_name,
      item.owner_name,
      item.owner_name,
      item.owner_name
    );
  END LOOP;
END $$;
