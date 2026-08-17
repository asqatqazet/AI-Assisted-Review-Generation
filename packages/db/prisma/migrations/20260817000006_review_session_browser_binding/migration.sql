-- US-01.3/US-02.3: persist the selected entry Action and bind each opaque
-- Review Session route to the browser capability that admitted it.
ALTER TABLE review_sessions
  ADD COLUMN selected_action generation_action;

CREATE TABLE review_session_browser_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  location_id uuid NOT NULL,
  review_session_id uuid NOT NULL,
  route_handle_hash varchar(128) NOT NULL UNIQUE,
  browser_capability_hash varchar(128) NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT review_session_browser_bindings_id_scope_unique
    UNIQUE (id, tenant_id, location_id, review_session_id),
  CONSTRAINT review_session_browser_bindings_session_browser_unique
    UNIQUE (tenant_id, review_session_id, browser_capability_hash),
  CONSTRAINT review_session_browser_bindings_expiry_after_create
    CHECK (expires_at > created_at),
  CONSTRAINT review_session_browser_bindings_revocation_after_create
    CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  CONSTRAINT review_session_browser_bindings_tenant_fk
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CONSTRAINT review_session_browser_bindings_location_fk
    FOREIGN KEY (location_id, tenant_id)
    REFERENCES locations(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT review_session_browser_bindings_session_fk
    FOREIGN KEY (review_session_id, tenant_id, location_id)
    REFERENCES review_sessions(id, tenant_id, location_id) ON DELETE RESTRICT
);

CREATE INDEX review_session_browser_bindings_capability_idx
  ON review_session_browser_bindings (browser_capability_hash, route_handle_hash);

-- This hash-only capability index intentionally has no RLS policy: Context
-- must resolve Tenant scope from an opaque route before it can SET LOCAL for
-- every business-table read. Only Context receives direct access; the values
-- are keyed hashes, never raw browser capabilities or route handles.
REVOKE ALL ON review_session_browser_bindings FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON review_session_browser_bindings TO context_svc;
