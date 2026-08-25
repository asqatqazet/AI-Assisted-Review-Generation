BEGIN;

-- Local browser acceptance identities. These OIDC-shaped identities are used
-- only by apps/web-bff/dev.ts; production authentication remains Cognito.
INSERT INTO operator_role_definitions (key, capabilities, status)
VALUES
  (
    'platform_admin',
    ARRAY[
      'console:read',
      'platform:admin',
      'provider:manage',
      'tenant:configure',
      'tenant:switch',
      'analytics:read',
      'ai:operate'
    ],
    'ACTIVE'
  ),
  (
    'tenant_admin',
    ARRAY['console:read', 'tenant:configure', 'analytics:read'],
    'ACTIVE'
  )
ON CONFLICT (key) DO UPDATE SET
  capabilities = EXCLUDED.capabilities,
  status = 'ACTIVE';

-- A second valid Tenant/Location pair lets browser acceptance prove that a
-- crossed pair is indistinguishable from any other unavailable resource.
INSERT INTO tenants (
  id,
  slug,
  name,
  locale,
  default_entry_mode_key,
  monthly_budget_micros,
  policy
)
VALUES (
  '00000000-0000-4000-8000-000000000401',
  'local-other-account',
  'Local Other Account',
  'en-GB',
  'open-qr',
  0,
  '{"maxActiveGenerations":1,"minimumFactSelections":1,"maximumCustomerAssertionChars":500}'::jsonb
)
ON CONFLICT (id) DO UPDATE SET
  slug = EXCLUDED.slug,
  name = EXCLUDED.name,
  status = 'ACTIVE';

INSERT INTO locations (id, tenant_id, slug, name, status)
VALUES (
  '00000000-0000-4000-8000-000000000402',
  '00000000-0000-4000-8000-000000000401',
  'local-other-location',
  'Local Other Location',
  'ACTIVE'
)
ON CONFLICT (id) DO UPDATE SET
  slug = EXCLUDED.slug,
  name = EXCLUDED.name,
  status = 'ACTIVE';

INSERT INTO operators (
  id,
  email,
  external_issuer,
  external_subject,
  status
)
VALUES
  (
    '00000000-0000-4000-8000-000000000301',
    :'platform_email',
    :'local_issuer',
    :'platform_subject',
    'ACTIVE'
  ),
  (
    '00000000-0000-4000-8000-000000000302',
    :'tenant_email',
    :'local_issuer',
    :'tenant_subject',
    'ACTIVE'
  )
ON CONFLICT (email) DO UPDATE SET
  external_issuer = EXCLUDED.external_issuer,
  external_subject = EXCLUDED.external_subject,
  status = 'ACTIVE';

INSERT INTO platform_access_grants (operator_id, role_key, status)
VALUES (
  '00000000-0000-4000-8000-000000000301',
  'platform_admin',
  'ACTIVE'
)
ON CONFLICT (operator_id, role_key) DO UPDATE SET
  status = 'ACTIVE',
  revoked_at = NULL;

INSERT INTO tenant_access_grants (tenant_id, operator_id, role_key, status)
VALUES
  (
    '00000000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-000000000301',
    'tenant_admin',
    'ACTIVE'
  ),
  (
    '00000000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-000000000302',
    'tenant_admin',
    'ACTIVE'
  )
ON CONFLICT (tenant_id, operator_id, role_key) DO UPDATE SET
  status = 'ACTIVE',
  revoked_at = NULL;

COMMIT;
