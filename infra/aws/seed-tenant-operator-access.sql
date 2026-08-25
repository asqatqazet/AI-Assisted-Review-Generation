\set ON_ERROR_STOP on

BEGIN;

SELECT set_config('review.operator_email', :'operator_email', true);
SELECT set_config('review.operator_issuer', :'operator_issuer', true);
SELECT set_config('review.operator_subject', :'operator_subject', true);
SELECT set_config('review.tenant_id', :'tenant_id', true);

-- This bootstrap is deliberately unable to create a Platform Grant. Cognito
-- delivers its own one-time invitation; no password or token enters CI output.
INSERT INTO operator_role_definitions (key, capabilities, status)
VALUES (
  'tenant_admin',
  ARRAY['console:read', 'tenant:configure', 'analytics:read'],
  'ACTIVE'
)
ON CONFLICT (key) DO UPDATE SET
  capabilities = CASE
    WHEN operator_role_definitions.status = 'ACTIVE'
      THEN EXCLUDED.capabilities
    ELSE operator_role_definitions.capabilities
  END;

INSERT INTO operators (email, external_issuer, external_subject, status)
VALUES (
  :'operator_email',
  :'operator_issuer',
  :'operator_subject',
  'ACTIVE'
)
ON CONFLICT (email) DO UPDATE SET
  external_issuer = EXCLUDED.external_issuer,
  external_subject = EXCLUDED.external_subject
WHERE (
  operators.external_issuer IS NULL AND operators.external_subject IS NULL
) OR (
  operators.external_issuer = EXCLUDED.external_issuer AND
  operators.external_subject = EXCLUDED.external_subject
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM operators
    WHERE email = current_setting('review.operator_email')
      AND external_issuer = current_setting('review.operator_issuer')
      AND external_subject = current_setting('review.operator_subject')
  ) THEN
    RAISE EXCEPTION 'Operator email is already bound to a different OIDC identity';
  END IF;
END $$;

SELECT set_config('app.tenant_id', current_setting('review.tenant_id'), true);

INSERT INTO tenant_access_grants (tenant_id, operator_id, role_key, status)
SELECT :'tenant_id', id, 'tenant_admin', 'ACTIVE'
FROM operators
WHERE email = :'operator_email'
ON CONFLICT (tenant_id, operator_id, role_key) DO NOTHING;

COMMIT;
