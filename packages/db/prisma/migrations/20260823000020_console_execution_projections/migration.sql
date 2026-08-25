-- Console execution projections are the only cross-Tenant read surface held by
-- generation_svc. Context signs the exact Tenant-id set and Generation verifies
-- it before calling these functions. The functions accept no operator-supplied
-- SQL and return aggregate/read-model JSON, never database rows or credentials.

CREATE OR REPLACE FUNCTION public.console_execution_authorized_tenant_ids(
  p_tenant_ids jsonb
) RETURNS uuid[]
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  parsed uuid[];
BEGIN
  IF jsonb_typeof(p_tenant_ids) <> 'array'
     OR jsonb_array_length(p_tenant_ids) > 1000 THEN
    RAISE EXCEPTION 'invalid Console Tenant set' USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(value::uuid ORDER BY ordinal)
    INTO parsed
    FROM jsonb_array_elements_text(p_tenant_ids) WITH ORDINALITY AS item(value, ordinal);

  IF cardinality(parsed) <> (
    SELECT count(DISTINCT tenant_id)
    FROM unnest(parsed) AS tenant_id
  ) THEN
    RAISE EXCEPTION 'invalid Console Tenant set' USING ERRCODE = '22023';
  END IF;
  RETURN COALESCE(parsed, ARRAY[]::uuid[]);
END;
$$;

REVOKE ALL ON FUNCTION public.console_execution_authorized_tenant_ids(jsonb)
  FROM PUBLIC;

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
          'subject', jsonb_build_object('id', location_id, 'name', location_name),
          'generations', generations,
          'accepted', accepted,
          'acceptanceRate', CASE WHEN generations = 0 THEN 0
            ELSE accepted::numeric / generations END,
          'totalCost', jsonb_build_object('amountMicros', total_cost, 'currency', 'EUR')
        ) ORDER BY location_name, location_id)
        FROM (
          SELECT location_id, max(location_name) AS location_name,
            count(*)::integer AS generations,
            count(*) FILTER (WHERE accepted)::integer AS accepted,
            COALESCE(sum(total_cost_micros), 0)::numeric AS total_cost
          FROM scoped GROUP BY location_id
        ) AS location_metric
      ), '[]'::jsonb),
      'byTenant', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'subject', jsonb_build_object('id', tenant_id, 'name', tenant_name),
          'generations', generations,
          'accepted', accepted,
          'acceptanceRate', CASE WHEN generations = 0 THEN 0
            ELSE accepted::numeric / generations END,
          'totalCost', jsonb_build_object('amountMicros', total_cost, 'currency', 'EUR')
        ) ORDER BY tenant_name, tenant_id)
        FROM (
          SELECT tenant_id, max(tenant_name) AS tenant_name,
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

REVOKE ALL ON FUNCTION public.console_execution_overview(
  jsonb, uuid, timestamptz, timestamptz
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.console_execution_overview(
  jsonb, uuid, timestamptz, timestamptz
) TO generation_svc;

CREATE OR REPLACE FUNCTION public.console_execution_analytics(
  p_tenant_ids jsonb,
  p_location_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_sort_key text,
  p_sort_direction text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  authorized_tenant_ids uuid[];
  rows jsonb;
BEGIN
  authorized_tenant_ids := public.console_execution_authorized_tenant_ids(p_tenant_ids);
  IF p_from >= p_to OR p_to - p_from > interval '366 days'
     OR p_sort_key NOT IN (
       'generations', 'acceptanceRate', 'averageEditDistance',
       'p95LatencyMs', 'totalCost', 'costPerAccepted'
     )
     OR p_sort_direction NOT IN ('asc', 'desc') THEN
    RAISE EXCEPTION 'invalid Console analytics query' USING ERRCODE = '22023';
  END IF;

  WITH attempts AS (
    SELECT generation_id,
      max(EXTRACT(epoch FROM (finished_at - started_at)) * 1000)
        FILTER (WHERE finished_at IS NOT NULL) AS latency_ms
    FROM public.provider_attempts
    WHERE tenant_id = ANY(authorized_tenant_ids)
    GROUP BY generation_id
  ), scoped AS (
    SELECT
      generation.tenant_id,
      generation.location_id,
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
      COALESCE(snapshot.payload->>'tenantName', generation.tenant_id::text) AS tenant_name,
      COALESCE(snapshot.payload->>'locationName', generation.location_id::text) AS location_name,
      COALESCE((
        SELECT format->>'displayName'
        FROM jsonb_array_elements(COALESCE(snapshot.payload->'reviewFormats', '[]'::jsonb)) AS format
        WHERE format->>'id' = generation.review_format_version_id::text
        LIMIT 1
      ), 'Unknown Review Format') AS review_format,
      (SELECT prompt->>'hash'
        FROM jsonb_array_elements(COALESCE(snapshot.payload->'promptVersions', '[]'::jsonb)) AS prompt
        WHERE prompt->>'id' = generation.prompt_version_id::text
        LIMIT 1) AS variant,
      generation.total_cost_micros,
      disposition.kind::text IN ('ACCEPTED', 'EDITED') AS accepted,
      COALESCE(disposition.normalized_edit_distance, 0)::numeric AS edit_distance,
      COALESCE(attempts.latency_ms, 0)::numeric AS latency_ms
    FROM public.generations AS generation
    JOIN public.effective_configuration_snapshots AS snapshot
      ON snapshot.id = generation.snapshot_id
     AND snapshot.tenant_id = generation.tenant_id
     AND snapshot.location_id = generation.location_id
    LEFT JOIN public.dispositions AS disposition
      ON disposition.generation_id = generation.id
     AND disposition.tenant_id = generation.tenant_id
     AND disposition.location_id = generation.location_id
     AND disposition.review_session_id = generation.review_session_id
    LEFT JOIN attempts ON attempts.generation_id = generation.id
    WHERE generation.tenant_id = ANY(authorized_tenant_ids)
      AND (p_location_id IS NULL OR generation.location_id = p_location_id)
      AND generation.created_at >= p_from
      AND generation.created_at < p_to
  ), grouped AS (
    SELECT tenant_id, location_id, action, max(tenant_name) AS tenant_name,
      max(location_name) AS location_name, review_format, variant,
      count(*)::integer AS generations,
      count(*) FILTER (WHERE accepted)::integer AS accepted,
      avg(edit_distance) AS average_edit_distance,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms)::numeric AS p50_latency,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)::numeric AS p95_latency,
      COALESCE(sum(total_cost_micros), 0)::numeric AS total_cost
    FROM scoped
    GROUP BY tenant_id, location_id, action, review_format, variant
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'tenant', jsonb_build_object('id', tenant_id, 'name', tenant_name),
    'location', jsonb_build_object('id', location_id, 'name', location_name),
    'action', action,
    'style', review_format,
    'variant', variant,
    'generations', generations,
    'acceptanceRate', CASE WHEN generations = 0 THEN 0
      ELSE accepted::numeric / generations END,
    'averageEditDistance', COALESCE(average_edit_distance, 0),
    'p50LatencyMs', round(COALESCE(p50_latency, 0)),
    'p95LatencyMs', round(COALESCE(p95_latency, 0)),
    'totalCost', jsonb_build_object('amountMicros', total_cost, 'currency', 'EUR'),
    'costPerAccepted', CASE WHEN accepted = 0 THEN NULL ELSE
      jsonb_build_object('amountMicros', round(total_cost / accepted), 'currency', 'EUR') END
  ) ORDER BY tenant_name, location_name, action), '[]'::jsonb)
  INTO rows FROM grouped;

  RETURN jsonb_build_object('status', 'analytics', 'rows', rows);
END;
$$;

REVOKE ALL ON FUNCTION public.console_execution_analytics(
  jsonb, uuid, timestamptz, timestamptz, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.console_execution_analytics(
  jsonb, uuid, timestamptz, timestamptz, text, text
) TO generation_svc;

CREATE OR REPLACE FUNCTION public.console_execution_generation_detail(
  p_tenant_ids jsonb,
  p_location_id uuid,
  p_generation_id uuid,
  p_may_read_raw_candidates boolean
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

  WITH RECURSIVE selected AS (
    SELECT generation.*, snapshot.payload AS snapshot_payload,
      batch.normalized_input,
      disposition.kind::text AS disposition_kind,
      disposition.normalized_edit_distance
    FROM public.generations AS generation
    JOIN public.effective_configuration_snapshots AS snapshot
      ON snapshot.id = generation.snapshot_id
     AND snapshot.tenant_id = generation.tenant_id
     AND snapshot.location_id = generation.location_id
    JOIN public.generation_batches AS batch
      ON batch.id = generation.generation_batch_id
     AND batch.tenant_id = generation.tenant_id
     AND batch.location_id = generation.location_id
     AND batch.review_session_id = generation.review_session_id
    LEFT JOIN public.dispositions AS disposition
      ON disposition.generation_id = generation.id
     AND disposition.tenant_id = generation.tenant_id
     AND disposition.location_id = generation.location_id
     AND disposition.review_session_id = generation.review_session_id
    WHERE generation.id = p_generation_id
      AND generation.tenant_id = ANY(authorized_tenant_ids)
      AND (p_location_id IS NULL OR generation.location_id = p_location_id)
  ), ancestors AS (
    SELECT generation.id, generation.source_generation_id, generation.action,
      generation.created_at, 1 AS depth
    FROM public.generations AS generation
    JOIN selected ON selected.source_generation_id = generation.id
      AND selected.tenant_id = generation.tenant_id
      AND selected.location_id = generation.location_id
      AND selected.review_session_id = generation.review_session_id
    UNION ALL
    SELECT generation.id, generation.source_generation_id, generation.action,
      generation.created_at, ancestors.depth + 1
    FROM public.generations AS generation
    JOIN ancestors ON ancestors.source_generation_id = generation.id
    WHERE ancestors.depth < 50
  ), descendants AS (
    SELECT generation.id, generation.source_generation_id, generation.action,
      generation.created_at, 1 AS depth
    FROM public.generations AS generation
    JOIN selected ON generation.source_generation_id = selected.id
      AND generation.tenant_id = selected.tenant_id
      AND generation.location_id = selected.location_id
      AND generation.review_session_id = selected.review_session_id
    UNION ALL
    SELECT generation.id, generation.source_generation_id, generation.action,
      generation.created_at, descendants.depth + 1
    FROM public.generations AS generation
    JOIN descendants ON generation.source_generation_id = descendants.id
    WHERE descendants.depth < 50
  )
  SELECT jsonb_build_object(
    'status', 'generation-detail',
    'generation', jsonb_build_object(
      'id', selected.id,
      'createdAt', selected.created_at,
      'tenant', jsonb_build_object(
        'id', selected.tenant_id,
        'name', COALESCE(selected.snapshot_payload->>'tenantName', selected.tenant_id::text)
      ),
      'location', jsonb_build_object(
        'id', selected.location_id,
        'name', COALESCE(selected.snapshot_payload->>'locationName', selected.location_id::text)
      ),
      'action', CASE selected.action::text
        WHEN 'GENERATE' THEN 'generate'
        WHEN 'PARAPHRASE' THEN 'paraphrase'
        WHEN 'REGENERATE' THEN 'resample'
        WHEN 'REFORMAT' THEN 'reformat'
        WHEN 'CONDENSE' THEN 'condense'
        WHEN 'EXPAND' THEN 'expand'
        WHEN 'REVISE_WORDING' THEN 'revise-wording'
        ELSE 'add-assertion'
      END,
      'style', jsonb_build_object(
        'id', selected.review_format_version_id,
        'name', COALESCE((SELECT format->>'displayName'
          FROM jsonb_array_elements(COALESCE(selected.snapshot_payload->'reviewFormats', '[]'::jsonb)) AS format
          WHERE format->>'id' = selected.review_format_version_id::text LIMIT 1),
          'Unknown Review Format'),
        'version', COALESCE((SELECT format->>'version'
          FROM jsonb_array_elements(COALESCE(selected.snapshot_payload->'reviewFormats', '[]'::jsonb)) AS format
          WHERE format->>'id' = selected.review_format_version_id::text LIMIT 1), 'unknown')
      ),
      'promptVersion', jsonb_build_object(
        'id', selected.prompt_version_id,
        'version', COALESCE((SELECT (prompt->>'version')::integer
          FROM jsonb_array_elements(COALESCE(selected.snapshot_payload->'promptVersions', '[]'::jsonb)) AS prompt
          WHERE prompt->>'id' = selected.prompt_version_id::text LIMIT 1), 1),
        'hash', COALESCE((SELECT prompt->>'hash'
          FROM jsonb_array_elements(COALESCE(selected.snapshot_payload->'promptVersions', '[]'::jsonb)) AS prompt
          WHERE prompt->>'id' = selected.prompt_version_id::text LIMIT 1), 'unknown')
      ),
      'contextVersion', NULL,
      'inputKeywords', COALESCE((SELECT jsonb_agg(assertion->>'proposition')
        FROM jsonb_array_elements(COALESCE(
          selected.normalized_input #> '{workload,assertions}', '[]'::jsonb
        )) AS assertion
        WHERE assertion #>> '{source,kind}' = 'fact-option'), '[]'::jsonb),
      'freeTextAssertions', COALESCE((SELECT jsonb_agg(assertion->>'proposition')
        FROM jsonb_array_elements(COALESCE(
          selected.normalized_input #> '{workload,assertions}', '[]'::jsonb
        )) AS assertion
        WHERE assertion #>> '{source,kind}' IN ('reviewer-text', 'confirmed-fact')), '[]'::jsonb),
      'sourceText', CASE WHEN p_may_read_raw_candidates THEN
        (SELECT string_agg(assertion #>> '{source,quotedText}', E'\n')
          FROM jsonb_array_elements(COALESCE(
            selected.normalized_input #> '{workload,assertions}', '[]'::jsonb
          )) AS assertion
          WHERE assertion #>> '{source,kind}' = 'reviewer-text')
        ELSE NULL END,
      'provider', COALESCE(selected.snapshot_payload #>> '{providerRouting,primaryProvider}', 'unknown'),
      'model', COALESCE(selected.snapshot_payload #>> '{providerRouting,primaryModel}', 'unknown'),
      'route', 'primary',
      'output', COALESCE(selected.grounded_output, ''),
      'claims', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', claim.id,
        'text', claim.proposition,
        'verdict', 'supported',
        'supportedBy', COALESCE((SELECT jsonb_agg(assertion.proposition)
          FROM public.claim_groundings AS grounding
          JOIN public.assertions AS assertion
            ON assertion.id = grounding.assertion_id
           AND assertion.tenant_id = grounding.tenant_id
           AND assertion.location_id = grounding.location_id
           AND assertion.review_session_id = grounding.review_session_id
          WHERE grounding.claim_id = claim.id), '[]'::jsonb)
      ) ORDER BY claim.ordinal)
        FROM public.claims AS claim
        WHERE claim.generation_id = selected.id
          AND claim.tenant_id = selected.tenant_id
          AND claim.location_id = selected.location_id
          AND claim.review_session_id = selected.review_session_id), '[]'::jsonb),
      'removedClaims', CASE WHEN p_may_read_raw_candidates THEN COALESCE((
        SELECT jsonb_agg(jsonb_build_object('text', output.text, 'reason', output.reason)
          ORDER BY output.ordinal)
        FROM public.unsupported_outputs AS output
        WHERE output.generation_id = selected.id
          AND output.tenant_id = selected.tenant_id
          AND output.location_id = selected.location_id
          AND output.review_session_id = selected.review_session_id
      ), '[]'::jsonb) ELSE NULL END,
      'cost', jsonb_build_object(
        'amountMicros', selected.total_cost_micros,
        'currency', COALESCE((SELECT rate->>'currency'
          FROM jsonb_array_elements(COALESCE(selected.snapshot_payload->'priceRates', '[]'::jsonb)) AS rate
          WHERE rate->>'id' = selected.normalized_input #>> '{workload,bindings,priceRateId}' LIMIT 1), 'EUR')
      ),
      'pricingVersionId', selected.normalized_input #>> '{workload,bindings,priceRateId}',
      'outcome', CASE selected.disposition_kind
        WHEN 'ACCEPTED' THEN 'accepted'
        WHEN 'EDITED' THEN 'accepted'
        WHEN 'DISCARDED' THEN 'discarded'
        ELSE 'pending'
      END,
      'editDistance', selected.normalized_edit_distance,
      'isBench', false
    ),
    'lineage', jsonb_build_object(
      'ancestors', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', ancestor.id,
        'action', CASE ancestor.action::text
          WHEN 'GENERATE' THEN 'generate' WHEN 'PARAPHRASE' THEN 'paraphrase'
          WHEN 'REGENERATE' THEN 'resample' WHEN 'REFORMAT' THEN 'reformat'
          WHEN 'CONDENSE' THEN 'condense' WHEN 'EXPAND' THEN 'expand'
          WHEN 'REVISE_WORDING' THEN 'revise-wording' ELSE 'add-assertion' END,
        'createdAt', ancestor.created_at
      ) ORDER BY ancestor.depth DESC) FROM ancestors AS ancestor), '[]'::jsonb),
      'descendants', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', descendant.id,
        'action', CASE descendant.action::text
          WHEN 'GENERATE' THEN 'generate' WHEN 'PARAPHRASE' THEN 'paraphrase'
          WHEN 'REGENERATE' THEN 'resample' WHEN 'REFORMAT' THEN 'reformat'
          WHEN 'CONDENSE' THEN 'condense' WHEN 'EXPAND' THEN 'expand'
          WHEN 'REVISE_WORDING' THEN 'revise-wording' ELSE 'add-assertion' END,
        'createdAt', descendant.created_at
      ) ORDER BY descendant.depth, descendant.created_at)
        FROM (SELECT * FROM descendants LIMIT 200) AS descendant), '[]'::jsonb)
    ),
    'replayable', selected.status::text = 'SUCCEEDED'
      AND selected.snapshot_payload->>'schemaVersion' = '2'
  ) INTO projection
  FROM selected;

  IF projection IS NULL THEN
    RETURN jsonb_build_object('status', 'not-found');
  END IF;
  RETURN projection;
END;
$$;

REVOKE ALL ON FUNCTION public.console_execution_generation_detail(
  jsonb, uuid, uuid, boolean
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.console_execution_generation_detail(
  jsonb, uuid, uuid, boolean
) TO generation_svc;
