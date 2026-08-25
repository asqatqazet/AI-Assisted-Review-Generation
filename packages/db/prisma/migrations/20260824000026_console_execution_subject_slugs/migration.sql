-- Console SummaryDto subjects require canonical slugs. Names remain bound to
-- the immutable execution snapshot, while routing slugs come from the current
-- owning Tenant and Location rows. The composite joins prevent a Location from
-- ever being projected under another Tenant.

CREATE OR REPLACE FUNCTION public.console_execution_overview(
  p_tenant_ids jsonb,
  p_location_id uuid,
  p_from timestamptz,
  p_to timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  authorized_tenant_ids uuid[];
  projection jsonb;
BEGIN
  authorized_tenant_ids := public.console_execution_authorized_tenant_ids(p_tenant_ids);
  IF p_from >= p_to OR p_to - p_from > interval '366 days' THEN
    RAISE EXCEPTION 'invalid Console window' USING ERRCODE = '22023';
  END IF;

  WITH scoped AS (
    SELECT
      generation.id,
      generation.tenant_id,
      generation.location_id,
      tenant.slug AS tenant_slug,
      location.slug AS location_slug,
      CASE generation.action::text
        WHEN 'GENERATE' THEN 'generate'
        WHEN 'PARAPHRASE' THEN 'paraphrase'
        WHEN 'REGENERATE' THEN 'resample'
        WHEN 'REFORMAT' THEN 'reformat'
        WHEN 'CONDENSE' THEN 'condense'
        WHEN 'EXPAND' THEN 'expand'
        WHEN 'REVISE_WORDING' THEN 'revise-wording'
        ELSE 'add-assertion'
      END AS action,
      generation.total_cost_micros,
      COALESCE(snapshot.payload->>'tenantName', generation.tenant_id::text) AS tenant_name,
      COALESCE(snapshot.payload->>'locationName', generation.location_id::text) AS location_name,
      disposition.kind::text IN ('ACCEPTED', 'EDITED') AS accepted
    FROM public.generations AS generation
    JOIN public.tenants AS tenant
      ON tenant.id = generation.tenant_id
    JOIN public.locations AS location
      ON location.id = generation.location_id
     AND location.tenant_id = generation.tenant_id
    JOIN public.effective_configuration_snapshots AS snapshot
      ON snapshot.id = generation.snapshot_id
     AND snapshot.tenant_id = generation.tenant_id
     AND snapshot.location_id = generation.location_id
    LEFT JOIN public.dispositions AS disposition
      ON disposition.generation_id = generation.id
     AND disposition.tenant_id = generation.tenant_id
     AND disposition.location_id = generation.location_id
     AND disposition.review_session_id = generation.review_session_id
    WHERE generation.tenant_id = ANY(authorized_tenant_ids)
      AND (p_location_id IS NULL OR generation.location_id = p_location_id)
      AND generation.created_at >= p_from
      AND generation.created_at < p_to
  ), totals AS (
    SELECT
      count(*)::integer AS generations,
      count(*) FILTER (WHERE accepted)::integer AS accepted,
      COALESCE(sum(total_cost_micros), 0)::numeric AS total_cost
    FROM scoped
  )
  SELECT jsonb_build_object(
    'status', 'overview',
    'data', jsonb_build_object(
      'window', jsonb_build_object('from', p_from, 'to', p_to),
      'metrics', jsonb_build_object(
        'generations', totals.generations,
        'accepted', totals.accepted,
        'acceptanceRate', CASE WHEN totals.generations = 0 THEN 0
          ELSE totals.accepted::numeric / totals.generations END,
        'totalCost', jsonb_build_object('amountMicros', totals.total_cost, 'currency', 'EUR'),
        'costPerAccepted', CASE WHEN totals.accepted = 0 THEN NULL ELSE
          jsonb_build_object(
            'amountMicros', round(totals.total_cost / totals.accepted),
            'currency', 'EUR'
          ) END
      ),
      'byAction', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'action', action,
          'generations', generations,
          'accepted', accepted,
          'acceptanceRate', CASE WHEN generations = 0 THEN 0
            ELSE accepted::numeric / generations END,
          'totalCost', jsonb_build_object('amountMicros', total_cost, 'currency', 'EUR')
        ) ORDER BY action)
        FROM (
          SELECT action, count(*)::integer AS generations,
            count(*) FILTER (WHERE accepted)::integer AS accepted,
            COALESCE(sum(total_cost_micros), 0)::numeric AS total_cost
          FROM scoped GROUP BY action
        ) AS action_metric
      ), '[]'::jsonb),
      'byLocation', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'subject', jsonb_build_object(
            'id', location_id,
            'slug', location_slug,
            'name', location_name
          ),
          'generations', generations,
          'accepted', accepted,
          'acceptanceRate', CASE WHEN generations = 0 THEN 0
            ELSE accepted::numeric / generations END,
          'totalCost', jsonb_build_object('amountMicros', total_cost, 'currency', 'EUR')
        ) ORDER BY location_name, location_id)
        FROM (
          SELECT location_id, max(location_slug) AS location_slug,
            max(location_name) AS location_name,
            count(*)::integer AS generations,
            count(*) FILTER (WHERE accepted)::integer AS accepted,
            COALESCE(sum(total_cost_micros), 0)::numeric AS total_cost
          FROM scoped GROUP BY location_id
        ) AS location_metric
      ), '[]'::jsonb),
      'byTenant', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'subject', jsonb_build_object(
            'id', tenant_id,
            'slug', tenant_slug,
            'name', tenant_name
          ),
          'generations', generations,
          'accepted', accepted,
          'acceptanceRate', CASE WHEN generations = 0 THEN 0
            ELSE accepted::numeric / generations END,
          'totalCost', jsonb_build_object('amountMicros', total_cost, 'currency', 'EUR')
        ) ORDER BY tenant_name, tenant_id)
        FROM (
          SELECT tenant_id, max(tenant_slug) AS tenant_slug,
            max(tenant_name) AS tenant_name,
            count(*)::integer AS generations,
            count(*) FILTER (WHERE accepted)::integer AS accepted,
            COALESCE(sum(total_cost_micros), 0)::numeric AS total_cost
          FROM scoped GROUP BY tenant_id
        ) AS tenant_metric
      ), '[]'::jsonb),
      'experiment', NULL,
      'providerHealth', '[]'::jsonb,
      'alerts', '[]'::jsonb
    )
  ) INTO projection
  FROM totals;

  RETURN projection;
END;
$$;

-- The one-argument authorization wrapper remains the only service-callable
-- shape. CREATE OR REPLACE preserves its private-helper ACL, and these explicit
-- revocations make that boundary auditable on upgraded as well as fresh DBs.
REVOKE ALL ON FUNCTION public.console_execution_overview(
  jsonb, uuid, timestamptz, timestamptz
) FROM PUBLIC, generation_svc, console_control_svc, context_runtime_svc;
