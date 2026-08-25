-- Disposable integration databases use TCP password authentication in CI.
-- Production credentials are provisioned independently and never use this
-- checked-in local-only password.
ALTER ROLE context_svc PASSWORD 'local_only_change_me';
ALTER ROLE context_runtime_svc PASSWORD 'local_only_change_me';
ALTER ROLE console_control_svc PASSWORD 'local_only_change_me';
ALTER ROLE generation_svc PASSWORD 'local_only_change_me';
