-- OffertaLogica Staff v0.36.65
-- Estensione Cruscotto economico: costi IA calcolatore sito separati per privati/business.
-- Non modifica premium_analysis_runs, non duplica i costi del ledger e non crea nuove API.

begin;

create or replace function public.premium_owner_economic_dashboard(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days integer := greatest(1, least(coalesce(p_days,30), 3650));
  v_since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days,30),3650)));
  v_lead_expected numeric := 0;
  v_lead_confirmed numeric := 0;
  v_result jsonb;
begin
  if not public.premium_economic_owner_allowed() then
    raise exception 'premium_owner_required' using errcode = '42501';
  end if;

  if to_regclass('public.lead_records') is not null then
    execute $q$
      select
        coalesce(sum(
          case
            when coalesce(record->'monetization'->>'expectedCommission','') ~ '^-?[0-9]+([.][0-9]+)?$'
            then (record->'monetization'->>'expectedCommission')::numeric
            else 0
          end
        ),0),
        coalesce(sum(
          case
            when lower(coalesce(record->'monetization'->>'status','')) in
              ('commission_approved','commission_confirmed','paid','pagato')
             and coalesce(record->'monetization'->>'expectedCommission','') ~ '^-?[0-9]+([.][0-9]+)?$'
            then (record->'monetization'->>'expectedCommission')::numeric
            else 0
          end
        ),0)
      from public.lead_records
      where created_at >= $1
    $q$ into v_lead_expected, v_lead_confirmed using v_since;
  end if;

  with
  active_rates as (
    select distinct on (r.rate_key)
      r.id, r.rate_key, r.label, r.category, r.rate_type, r.rate_value,
      r.currency, r.vat_rate, r.source_mode, r.source_reference, r.notes,
      r.valid_from, r.valid_to
    from public.premium_economic_rate_versions r
    where r.valid_from <= now()
      and (r.valid_to is null or r.valid_to > now())
    order by r.rate_key, r.valid_from desc
  ),
  ai as (
    select
      count(*)::bigint as runs,
      count(*) filter (where run.status = 'failed')::bigint as failed,
      coalesce(sum(run.estimated_cost_eur) filter (
        where run.estimated_cost_eur is not null
          and (
            coalesce(run.usage_details->>'pricing_verified_eur','false') = 'true'
            or coalesce(run.usage_details->>'pricing_version','') <> ''
          )
      ),0)::numeric as cost
    from public.premium_analysis_runs run
    where run.created_at >= v_since
  ),
  site_ai as (
    select
      count(*) filter (where e.category = 'site_pdf_ai_consumer')::bigint as consumer_runs,
      count(*) filter (where e.category = 'site_pdf_ai_consumer' and coalesce(e.metadata->>'outcome','') = 'failed')::bigint as consumer_failed,
      count(*) filter (where e.category = 'site_pdf_ai_consumer' and (e.status = 'unpriced' or e.amount_gross_eur is null))::bigint as consumer_unpriced,
      coalesce(sum(e.amount_gross_eur) filter (
        where e.category = 'site_pdf_ai_consumer' and e.status in ('incurred','paid','confirmed')
      ),0)::numeric as consumer_cost_real,
      coalesce(sum(e.amount_gross_eur) filter (
        where e.category = 'site_pdf_ai_consumer' and e.status = 'estimated'
      ),0)::numeric as consumer_cost_estimated,

      count(*) filter (where e.category = 'site_pdf_ai_business')::bigint as business_runs,
      count(*) filter (where e.category = 'site_pdf_ai_business' and coalesce(e.metadata->>'outcome','') = 'failed')::bigint as business_failed,
      count(*) filter (where e.category = 'site_pdf_ai_business' and (e.status = 'unpriced' or e.amount_gross_eur is null))::bigint as business_unpriced,
      coalesce(sum(e.amount_gross_eur) filter (
        where e.category = 'site_pdf_ai_business' and e.status in ('incurred','paid','confirmed')
      ),0)::numeric as business_cost_real,
      coalesce(sum(e.amount_gross_eur) filter (
        where e.category = 'site_pdf_ai_business' and e.status = 'estimated'
      ),0)::numeric as business_cost_estimated,

      count(*) filter (where e.category = 'site_pdf_ai_unknown')::bigint as unknown_runs,
      count(*) filter (where e.category = 'site_pdf_ai_unknown' and coalesce(e.metadata->>'outcome','') = 'failed')::bigint as unknown_failed,
      count(*) filter (where e.category = 'site_pdf_ai_unknown' and (e.status = 'unpriced' or e.amount_gross_eur is null))::bigint as unknown_unpriced,
      coalesce(sum(e.amount_gross_eur) filter (
        where e.category = 'site_pdf_ai_unknown' and e.status in ('incurred','paid','confirmed')
      ),0)::numeric as unknown_cost_real,
      coalesce(sum(e.amount_gross_eur) filter (
        where e.category = 'site_pdf_ai_unknown' and e.status = 'estimated'
      ),0)::numeric as unknown_cost_estimated
    from public.premium_economic_entries e
    where e.occurred_at >= v_since
      and e.source_system = 'site_pdf_ai'
  ),
  human as (
    select
      coalesce(sum(chk.human_seconds),0)::bigint as seconds,
      coalesce(sum(
        case when rate.rate_value is null then 0
             else (chk.human_seconds::numeric / 3600) * rate.rate_value end
      ),0)::numeric as cost,
      count(*) filter (where chk.human_seconds > 0 and rate.rate_value is null)::bigint as unpriced
    from public.premium_checks chk
    left join lateral (
      select r.rate_value
      from public.premium_economic_rate_versions r
      where r.rate_key = 'operator_hour_eur'
        and r.valid_from <= coalesce(chk.completed_at, chk.created_at)
        and (r.valid_to is null or r.valid_to > coalesce(chk.completed_at, chk.created_at))
      order by r.valid_from desc
      limit 1
    ) rate on true
    where coalesce(chk.completed_at, chk.created_at) >= v_since
  ),
  legacy_costs as (
    select coalesce(sum(cost.cost_eur),0)::numeric as cost
    from public.premium_cost_events cost
    where cost.occurred_at >= v_since
      and not (cost.event_type = 'ai_analysis' and cost.analysis_run_id is not null)
      and not (cost.event_type = 'human_review' and cost.check_id is not null)
  ),
  scheduled_costs as (
    select coalesce(sum(
      (
        r.rate_value * (1 + coalesce(r.vat_rate,0) / 100)
      ) *
      greatest(
        0,
        extract(epoch from (
          least(coalesce(r.valid_to, now()), now()) - greatest(r.valid_from, v_since)
        )) / 86400
      ) /
      case when r.rate_type = 'per_year' then 365.25 else 30.4375 end
    ),0)::numeric as cost
    from public.premium_economic_rate_versions r
    where r.rate_type in ('per_month','per_year')
      and r.valid_from < now()
      and coalesce(r.valid_to, now()) > v_since
  ),
  ledger as (
    select
      coalesce(sum(e.amount_gross_eur) filter (
        where e.direction = 'revenue' and e.status in ('confirmed','paid')
      ),0)::numeric as revenue_real,
      coalesce(sum(e.amount_gross_eur) filter (
        where e.direction = 'revenue' and e.status in ('expected','estimated')
      ),0)::numeric as revenue_expected,
      coalesce(sum(e.amount_gross_eur) filter (
        where e.direction = 'cost' and e.status in ('incurred','paid','confirmed')
      ),0)::numeric as cost_real,
      coalesce(sum(e.amount_gross_eur) filter (
        where e.direction = 'cost' and e.status = 'estimated'
      ),0)::numeric as cost_estimated,
      coalesce(sum(e.amount_gross_eur) filter (
        where e.direction = 'cost' and e.status in ('incurred','paid','confirmed')
          and e.source_system <> 'site_pdf_ai'
      ),0)::numeric as cost_real_other,
      coalesce(sum(e.amount_gross_eur) filter (
        where e.direction = 'cost' and e.status = 'estimated'
          and e.source_system <> 'site_pdf_ai'
      ),0)::numeric as cost_estimated_other,
      coalesce(sum(e.amount_gross_eur) filter (
        where e.direction = 'adjustment' and e.status not in ('reversed','unpriced')
      ),0)::numeric as adjustments,
      count(*) filter (where e.status = 'unpriced' or e.amount_gross_eur is null)::bigint as unpriced
    from public.premium_economic_entries e
    where e.occurred_at >= v_since
  ),
  recent_entries as (
    select coalesce(jsonb_agg(to_jsonb(x) order by x.occurred_at desc),'[]'::jsonb) as rows
    from (
      select
        e.id, e.direction, e.status, e.category, e.source_system, e.source_event_id,
        e.quantity, e.unit, e.original_amount, e.original_currency,
        e.amount_net_eur, e.vat_rate, e.vat_eur, e.amount_gross_eur,
        e.occurred_at, e.competence_start, e.competence_end, e.notes
      from public.premium_economic_entries e
      where e.occurred_at >= v_since
      order by e.occurred_at desc
      limit 100
    ) x
  ),
  rate_rows as (
    select coalesce(jsonb_agg(to_jsonb(r) order by r.category, r.label),'[]'::jsonb) as rows
    from active_rates r
  )
  select jsonb_build_object(
    'generated_at', now(),
    'days', v_days,
    'from', v_since,
    'kpi', jsonb_build_object(
      'revenue_confirmed_eur', ledger.revenue_real + v_lead_confirmed,
      'revenue_expected_eur', ledger.revenue_expected + greatest(v_lead_expected - v_lead_confirmed, 0),
      'cost_real_eur', ai.cost + human.cost + legacy_costs.cost + ledger.cost_real,
      'cost_estimated_eur', ledger.cost_estimated + scheduled_costs.cost,
      'adjustments_eur', ledger.adjustments,
      'result_real_eur',
        (ledger.revenue_real + v_lead_confirmed + ledger.adjustments)
        - (ai.cost + human.cost + legacy_costs.cost + ledger.cost_real),
      'result_expected_eur',
        (ledger.revenue_real + v_lead_expected + ledger.revenue_expected + ledger.adjustments)
        - (ai.cost + human.cost + legacy_costs.cost + ledger.cost_real + ledger.cost_estimated + scheduled_costs.cost),
      'margin_real_pct',
        case when (ledger.revenue_real + v_lead_confirmed) = 0 then null
        else round(
          (
            ((ledger.revenue_real + v_lead_confirmed + ledger.adjustments)
              - (ai.cost + human.cost + legacy_costs.cost + ledger.cost_real))
            / (ledger.revenue_real + v_lead_confirmed)
          ) * 100, 2
        ) end,
      'unpriced_count', ledger.unpriced + human.unpriced
    ),
    'breakdown', jsonb_build_object(
      'premium_ai_cost_eur', ai.cost,
      'premium_ai_runs', ai.runs,
      'premium_ai_failed', ai.failed,

      'site_pdf_ai_consumer_cost_real_eur', site_ai.consumer_cost_real,
      'site_pdf_ai_consumer_cost_estimated_eur', site_ai.consumer_cost_estimated,
      'site_pdf_ai_consumer_runs', site_ai.consumer_runs,
      'site_pdf_ai_consumer_failed', site_ai.consumer_failed,
      'site_pdf_ai_consumer_unpriced', site_ai.consumer_unpriced,

      'site_pdf_ai_business_cost_real_eur', site_ai.business_cost_real,
      'site_pdf_ai_business_cost_estimated_eur', site_ai.business_cost_estimated,
      'site_pdf_ai_business_runs', site_ai.business_runs,
      'site_pdf_ai_business_failed', site_ai.business_failed,
      'site_pdf_ai_business_unpriced', site_ai.business_unpriced,

      'site_pdf_ai_unknown_cost_real_eur', site_ai.unknown_cost_real,
      'site_pdf_ai_unknown_cost_estimated_eur', site_ai.unknown_cost_estimated,
      'site_pdf_ai_unknown_runs', site_ai.unknown_runs,
      'site_pdf_ai_unknown_failed', site_ai.unknown_failed,
      'site_pdf_ai_unknown_unpriced', site_ai.unknown_unpriced,

      'human_seconds', human.seconds,
      'human_cost_eur', human.cost,
      'legacy_recorded_cost_eur', legacy_costs.cost,
      'ledger_cost_real_eur', ledger.cost_real,
      'ledger_cost_estimated_eur', ledger.cost_estimated,
      'ledger_cost_real_other_eur', ledger.cost_real_other,
      'ledger_cost_estimated_other_eur', ledger.cost_estimated_other,
      'scheduled_cost_estimated_eur', scheduled_costs.cost,
      'premium_and_manual_revenue_real_eur', ledger.revenue_real,
      'lead_commission_expected_eur', v_lead_expected,
      'lead_commission_confirmed_eur', v_lead_confirmed
    ),
    'rates', rate_rows.rows,
    'entries', recent_entries.rows
  )
  into v_result
  from ai, site_ai, human, legacy_costs, scheduled_costs, ledger, recent_entries, rate_rows;

  return coalesce(v_result,'{}'::jsonb);
end;
$$;

revoke all on function public.premium_owner_economic_dashboard(integer) from public, anon;
grant execute on function public.premium_owner_economic_dashboard(integer) to authenticated, service_role;

comment on function public.premium_owner_economic_dashboard(integer) is
  'Cruscotto economico Owner-only; separa costi IA Premium e calcolatore sito privati/business senza duplicare il ledger.';

commit;
