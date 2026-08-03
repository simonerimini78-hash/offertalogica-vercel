-- Verifica OFFERTALOGICA PREMIUM v0.36.3

do $$
declare
  definition text;
begin
  definition := pg_get_functiondef('public.premium_request_check(uuid)'::regprocedure);

  if definition not ilike '%v_screening_status <> ''review_recommended''%' then
    raise exception 'traffic_light_red_only_missing';
  end if;

  if definition not ilike '%v_processing_status <> ''completed''%' then
    raise exception 'traffic_light_completed_only_missing';
  end if;

  if definition not ilike '%v_customer_status <> ''anomaly_found''%' then
    raise exception 'traffic_light_customer_red_missing';
  end if;

  if definition ilike '%v_screening_status not in (''review_recommended'', ''inconclusive'', ''failed'')%' then
    raise exception 'legacy_yellow_staff_rule_still_present';
  end if;

  if definition not ilike '%premium-traffic-light-v0.36.3%' then
    raise exception 'traffic_light_consent_version_missing';
  end if;
end;
$$;

select 'premium_traffic_light_v0.36.3_ok' as verification_result;
