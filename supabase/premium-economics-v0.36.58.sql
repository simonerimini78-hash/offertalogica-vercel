-- OffertaLogica Staff v0.36.58
-- Cruscotto economico: tariffe versionate + registro economico Owner-only.
-- Non crea API Vercel e non modifica i registri IA Premium esistenti.

begin;

do $$
begin
  if to_regclass('public.premium_staff_members') is null then
    raise exception 'premium_staff_members_missing';
  end if;
  if to_regclass('public.premium_analysis_runs') is null then
    raise exception 'premium_analysis_runs_missing';
  end if;
  if to_regclass('public.premium_checks') is null then
    raise exception 'premium_checks_missing';
  end if;
  if to_regclass('public.premium_cost_events') is null then
    raise exception 'premium_cost_events_missing';
  end if;
end;
$$;

create table if not exists public.premium_economic_rate_versions (
  id uuid primary key default gen_random_uuid(),
  rate_key text not null,
  label text not null,
  category text not null default 'other',
  rate_type text not null default 'per_unit'
    check (rate_type in ('per_unit','fixed','percent','per_hour','per_million','per_month','per_year')),
  rate_value numeric(20,8) not null check (rate_value >= 0),
  currency text not null default 'EUR',
  vat_rate numeric(7,4) check (vat_rate is null or (vat_rate >= 0 and vat_rate <= 100)),
  source_mode text not null default 'manual'
    check (source_mode in ('manual','automatic','estimated','provider_list')),
  source_reference text not null default '',
  notes text not null default '',
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  created_by_staff_id uuid references public.premium_staff_members(user_id) on delete set null,
  created_at timestamptz not null default now(),
  constraint premium_economic_rate_validity check (valid_to is null or valid_to > valid_from),
  unique (rate_key, valid_from)
);

create index if not exists premium_economic_rate_versions_lookup_idx
  on public.premium_economic_rate_versions (rate_key, valid_from desc);

create table if not exists public.premium_economic_entries (
  id uuid primary key default gen_random_uuid(),
  direction text not null check (direction in ('cost','revenue','adjustment')),
  status text not null
    check (status in ('expected','estimated','incurred','confirmed','paid','refunded','reversed','unpriced')),
  category text not null,
  source_system text not null default 'manual',
  source_event_id text,
  user_id uuid references auth.users(id) on delete set null,
  lead_id text,
  bill_id uuid references public.premium_bills(id) on delete set null,
  analysis_run_id uuid references public.premium_analysis_runs(id) on delete set null,
  check_id uuid references public.premium_checks(id) on delete set null,
  rate_version_id uuid references public.premium_economic_rate_versions(id) on delete set null,
  quantity numeric(20,8) not null default 1,
  unit text not null default 'event',
  original_amount numeric(20,8),
  original_currency text not null default 'EUR',
  fx_rate_to_eur numeric(20,10),
  amount_net_eur numeric(20,8),
  vat_rate numeric(7,4) check (vat_rate is null or (vat_rate >= 0 and vat_rate <= 100)),
  vat_eur numeric(20,8),
  amount_gross_eur numeric(20,8),
  occurred_at timestamptz not null default now(),
  competence_start date,
  competence_end date,
  notes text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_by_staff_id uuid references public.premium_staff_members(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint premium_economic_entry_competence check (
    competence_end is null or competence_start is null or competence_end >= competence_start
  ),
  unique (source_system, source_event_id, category)
);

create index if not exists premium_economic_entries_occurred_idx
  on public.premium_economic_entries (occurred_at desc);
create index if not exists premium_economic_entries_direction_idx
  on public.premium_economic_entries (direction, status, occurred_at desc);
create index if not exists premium_economic_entries_user_idx
  on public.premium_economic_entries (user_id, occurred_at desc)
  where user_id is not null;

create or replace function public.premium_economic_entry_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists premium_economic_entries_set_updated_at on public.premium_economic_entries;
create trigger premium_economic_entries_set_updated_at
before update on public.premium_economic_entries
for each row execute procedure public.premium_economic_entry_updated_at();

-- Controllo Owner autonomo e coerente con il Control Center: usa la stessa
-- membership premium_staff_members letta dal frontend Staff.
create or replace function public.premium_economic_owner_allowed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.premium_staff_members staff
    where staff.user_id = auth.uid()
      and staff.active is true
      and lower(trim(staff.role::text)) = 'owner'
  );
$$;

revoke all on function public.premium_economic_owner_allowed() from public, anon;
grant execute on function public.premium_economic_owner_allowed() to authenticated, service_role;

alter table public.premium_economic_rate_versions enable row level security;
alter table public.premium_economic_entries enable row level security;

revoke all on table public.premium_economic_rate_versions, public.premium_economic_entries
from public, anon, authenticated;

grant select on table public.premium_economic_rate_versions, public.premium_economic_entries
to authenticated;
grant all on table public.premium_economic_rate_versions, public.premium_economic_entries
to service_role;

drop policy if exists premium_economic_rates_owner_select on public.premium_economic_rate_versions;
create policy premium_economic_rates_owner_select
on public.premium_economic_rate_versions
for select to authenticated
using (public.premium_economic_owner_allowed());

drop policy if exists premium_economic_entries_owner_select on public.premium_economic_entries;
create policy premium_economic_entries_owner_select
on public.premium_economic_entries
for select to authenticated
using (public.premium_economic_owner_allowed());

-- Salva una nuova versione di tariffa senza riscrivere il passato.
create or replace function public.premium_owner_set_economic_rate(
  p_rate_key text,
  p_label text,
  p_category text,
  p_rate_type text,
  p_rate_value numeric,
  p_currency text default 'EUR',
  p_vat_rate numeric default null,
  p_source_mode text default 'manual',
  p_source_reference text default '',
  p_notes text default '',
  p_valid_from timestamptz default now()
)
returns public.premium_economic_rate_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_valid_from timestamptz := coalesce(p_valid_from, now());
  v_next_from timestamptz;
  v_row public.premium_economic_rate_versions;
begin
  if not public.premium_economic_owner_allowed() then
    raise exception 'premium_owner_required' using errcode = '42501';
  end if;
  if coalesce(trim(p_rate_key), '') = '' or coalesce(trim(p_label), '') = '' then
    raise exception 'premium_economic_rate_invalid';
  end if;
  if p_rate_value is null or p_rate_value < 0 then
    raise exception 'premium_economic_rate_value_invalid';
  end if;
  if p_vat_rate is not null and (p_vat_rate < 0 or p_vat_rate > 100) then
    raise exception 'premium_economic_rate_vat_invalid';
  end if;
  if p_rate_type not in ('per_unit','fixed','percent','per_hour','per_million','per_month','per_year') then
    raise exception 'premium_economic_rate_type_invalid';
  end if;
  if p_source_mode not in ('manual','automatic','estimated','provider_list') then
    raise exception 'premium_economic_rate_source_invalid';
  end if;

  select min(r.valid_from)
    into v_next_from
  from public.premium_economic_rate_versions r
  where r.rate_key = trim(p_rate_key)
    and r.valid_from > v_valid_from;

  update public.premium_economic_rate_versions r
  set valid_to = v_valid_from
  where r.rate_key = trim(p_rate_key)
    and r.valid_from < v_valid_from
    and (r.valid_to is null or r.valid_to > v_valid_from);

  insert into public.premium_economic_rate_versions (
    rate_key, label, category, rate_type, rate_value, currency, vat_rate,
    source_mode, source_reference, notes, valid_from, valid_to, created_by_staff_id
  )
  values (
    trim(p_rate_key), trim(p_label), coalesce(nullif(trim(p_category),''),'other'),
    p_rate_type, p_rate_value, upper(coalesce(nullif(trim(p_currency),''),'EUR')),
    p_vat_rate, p_source_mode, coalesce(p_source_reference,''),
    coalesce(p_notes,''), v_valid_from, v_next_from, v_actor
  )
  returning * into v_row;

  return v_row;
end;
$$;

-- Movimento manuale; l'importo può essere netto o lordo e può essere negativo per rettifiche.
create or replace function public.premium_owner_add_economic_entry(
  p_direction text,
  p_status text,
  p_category text,
  p_amount numeric default null,
  p_amount_basis text default 'gross',
  p_vat_rate numeric default null,
  p_currency text default 'EUR',
  p_fx_rate_to_eur numeric default null,
  p_quantity numeric default 1,
  p_unit text default 'event',
  p_occurred_at timestamptz default now(),
  p_competence_start date default null,
  p_competence_end date default null,
  p_notes text default '',
  p_metadata jsonb default '{}'::jsonb
)
returns public.premium_economic_entries
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_currency text := upper(coalesce(nullif(trim(p_currency),''),'EUR'));
  v_fx numeric := case when v_currency = 'EUR' then 1 else p_fx_rate_to_eur end;
  v_amount_eur numeric;
  v_net numeric;
  v_vat numeric;
  v_gross numeric;
  v_row public.premium_economic_entries;
begin
  if not public.premium_economic_owner_allowed() then
    raise exception 'premium_owner_required' using errcode = '42501';
  end if;
  if p_direction not in ('cost','revenue','adjustment') then
    raise exception 'premium_economic_direction_invalid';
  end if;
  if p_status not in ('expected','estimated','incurred','confirmed','paid','refunded','reversed','unpriced') then
    raise exception 'premium_economic_status_invalid';
  end if;
  if coalesce(trim(p_category),'') = '' then
    raise exception 'premium_economic_category_invalid';
  end if;
  if p_vat_rate is not null and (p_vat_rate < 0 or p_vat_rate > 100) then
    raise exception 'premium_economic_vat_invalid';
  end if;
  if p_amount_basis not in ('net','gross') then
    raise exception 'premium_economic_amount_basis_invalid';
  end if;
  if p_amount is not null and v_currency <> 'EUR' and (v_fx is null or v_fx <= 0) then
    raise exception 'premium_economic_fx_required';
  end if;

  v_amount_eur := case when p_amount is null then null else p_amount * coalesce(v_fx,1) end;
  if v_amount_eur is not null then
    if p_amount_basis = 'net' then
      v_net := v_amount_eur;
      v_vat := case when p_vat_rate is null then null else v_net * p_vat_rate / 100 end;
      v_gross := v_net + coalesce(v_vat,0);
    else
      v_gross := v_amount_eur;
      v_net := case
        when p_vat_rate is null then v_gross
        else v_gross / (1 + p_vat_rate / 100)
      end;
      v_vat := case when p_vat_rate is null then null else v_gross - v_net end;
    end if;
  end if;

  insert into public.premium_economic_entries (
    direction, status, category, source_system, source_event_id,
    quantity, unit, original_amount, original_currency, fx_rate_to_eur,
    amount_net_eur, vat_rate, vat_eur, amount_gross_eur,
    occurred_at, competence_start, competence_end, notes, metadata,
    created_by_staff_id
  )
  values (
    p_direction, p_status, trim(p_category), 'manual', null,
    coalesce(p_quantity,1), coalesce(nullif(trim(p_unit),''),'event'),
    p_amount, v_currency, v_fx, v_net, p_vat_rate, v_vat, v_gross,
    coalesce(p_occurred_at,now()), p_competence_start, p_competence_end,
    coalesce(p_notes,''), coalesce(p_metadata,'{}'::jsonb), v_actor
  )
  returning * into v_row;

  return v_row;
end;
$$;

-- Modifica di una voce manuale. Le voci automatiche non si alterano: si rettificano.
create or replace function public.premium_owner_update_manual_economic_entry(
  p_id uuid,
  p_status text,
  p_amount numeric default null,
  p_amount_basis text default 'gross',
  p_vat_rate numeric default null,
  p_currency text default 'EUR',
  p_fx_rate_to_eur numeric default null,
  p_notes text default ''
)
returns public.premium_economic_entries
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.premium_economic_entries;
  v_currency text := upper(coalesce(nullif(trim(p_currency),''),'EUR'));
  v_fx numeric := case when v_currency = 'EUR' then 1 else p_fx_rate_to_eur end;
  v_amount_eur numeric;
  v_net numeric;
  v_vat numeric;
  v_gross numeric;
  v_row public.premium_economic_entries;
begin
  if not public.premium_economic_owner_allowed() then
    raise exception 'premium_owner_required' using errcode = '42501';
  end if;
  select * into v_existing from public.premium_economic_entries where id = p_id;
  if not found then raise exception 'premium_economic_entry_not_found'; end if;
  if v_existing.source_system <> 'manual' then
    raise exception 'premium_economic_automatic_entry_protected';
  end if;
  if p_status not in ('expected','estimated','incurred','confirmed','paid','refunded','reversed','unpriced') then
    raise exception 'premium_economic_status_invalid';
  end if;
  if p_amount is not null and v_currency <> 'EUR' and (v_fx is null or v_fx <= 0) then
    raise exception 'premium_economic_fx_required';
  end if;

  v_amount_eur := case when p_amount is null then null else p_amount * coalesce(v_fx,1) end;
  if v_amount_eur is not null then
    if p_amount_basis = 'net' then
      v_net := v_amount_eur;
      v_vat := case when p_vat_rate is null then null else v_net * p_vat_rate / 100 end;
      v_gross := v_net + coalesce(v_vat,0);
    else
      v_gross := v_amount_eur;
      v_net := case when p_vat_rate is null then v_gross else v_gross / (1 + p_vat_rate / 100) end;
      v_vat := case when p_vat_rate is null then null else v_gross - v_net end;
    end if;
  end if;

  update public.premium_economic_entries
  set status = p_status,
      original_amount = p_amount,
      original_currency = v_currency,
      fx_rate_to_eur = v_fx,
      amount_net_eur = v_net,
      vat_rate = p_vat_rate,
      vat_eur = v_vat,
      amount_gross_eur = v_gross,
      notes = coalesce(p_notes,'')
  where id = p_id
  returning * into v_row;
  return v_row;
end;
$$;

-- Snapshot aggregato Owner-only. Riusa i costi IA Premium senza duplicarli.
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
      'human_seconds', human.seconds,
      'human_cost_eur', human.cost,
      'legacy_recorded_cost_eur', legacy_costs.cost,
      'ledger_cost_real_eur', ledger.cost_real,
      'ledger_cost_estimated_eur', ledger.cost_estimated,
      'scheduled_cost_estimated_eur', scheduled_costs.cost,
      'premium_and_manual_revenue_real_eur', ledger.revenue_real,
      'lead_commission_expected_eur', v_lead_expected,
      'lead_commission_confirmed_eur', v_lead_confirmed
    ),
    'rates', rate_rows.rows,
    'entries', recent_entries.rows
  )
  into v_result
  from ai, human, legacy_costs, scheduled_costs, ledger, recent_entries, rate_rows;

  return coalesce(v_result,'{}'::jsonb);
end;
$$;

revoke all on function public.premium_owner_set_economic_rate(text,text,text,text,numeric,text,numeric,text,text,text,timestamptz)
from public, anon;
revoke all on function public.premium_owner_add_economic_entry(text,text,text,numeric,text,numeric,text,numeric,numeric,text,timestamptz,date,date,text,jsonb)
from public, anon;
revoke all on function public.premium_owner_update_manual_economic_entry(uuid,text,numeric,text,numeric,text,numeric,text)
from public, anon;
revoke all on function public.premium_owner_economic_dashboard(integer)
from public, anon;

grant execute on function public.premium_owner_set_economic_rate(text,text,text,text,numeric,text,numeric,text,text,text,timestamptz)
to authenticated, service_role;
grant execute on function public.premium_owner_add_economic_entry(text,text,text,numeric,text,numeric,text,numeric,numeric,text,timestamptz,date,date,text,jsonb)
to authenticated, service_role;
grant execute on function public.premium_owner_update_manual_economic_entry(uuid,text,numeric,text,numeric,text,numeric,text)
to authenticated, service_role;
grant execute on function public.premium_owner_economic_dashboard(integer)
to authenticated, service_role;

-- Valori iniziali. Da questo momento in poi l'Owner può modificarli dallo Staff.
insert into public.premium_economic_rate_versions
  (rate_key,label,category,rate_type,rate_value,currency,vat_rate,source_mode,source_reference,notes,valid_from)
values
  ('operator_hour_eur','Costo operatore','personale','per_hour',30,'EUR',null,'manual',
   'Valore operativo già usato nello Staff prima del cruscotto economico',
   'Baseline storica: 30 €/h.', '2000-01-01T00:00:00Z'),
  ('sms_aruba_net_eur','SMS Aruba','sms','per_unit',0.059,'EUR',22,'manual',
   'Contratto Aruba corrente verificato al 2026-08-23',
   'Costo netto per invio riuscito; IVA separata.', '2026-08-23T00:00:00+02:00'),
  ('stripe_fee_percent','Stripe - quota percentuale stimata','pagamenti','percent',1.5,'EUR',null,'estimated',
   'Default illustrativo da sostituire con il contratto Stripe effettivo',
   'Stima modificabile dall’Owner.', '2026-08-23T00:00:00+02:00'),
  ('stripe_fee_fixed_eur','Stripe - quota fissa stimata','pagamenti','fixed',0.25,'EUR',null,'estimated',
   'Default illustrativo da sostituire con il contratto Stripe effettivo',
   'Stima modificabile dall’Owner.', '2026-08-23T00:00:00+02:00'),
  ('openai_gpt41_input_usd_1m','OpenAI GPT-4.1 input','ia','per_million',2,'USD',null,'provider_list',
   'Listino modello GPT-4.1 usato dalla base v0.36.56',
   'USD per milione di token; conversione EUR al cambio BCE.', '2025-04-14T00:00:00Z'),
  ('openai_gpt41_cached_input_usd_1m','OpenAI GPT-4.1 cached input','ia','per_million',0.5,'USD',null,'provider_list',
   'Listino modello GPT-4.1 usato dalla base v0.36.56',
   'USD per milione di token; conversione EUR al cambio BCE.', '2025-04-14T00:00:00Z'),
  ('openai_gpt41_output_usd_1m','OpenAI GPT-4.1 output','ia','per_million',8,'USD',null,'provider_list',
   'Listino modello GPT-4.1 usato dalla base v0.36.56',
   'USD per milione di token; conversione EUR al cambio BCE.', '2025-04-14T00:00:00Z'),
  ('vercel_monthly_eur','Vercel - costo mensile','infrastruttura','per_month',0,'EUR',null,'manual',
   'Da impostare in base al piano realmente fatturato',
   'Lo zero iniziale indica costo configurato a 0; modificarlo se il piano genera costo.', '2026-08-23T00:00:00+02:00')
on conflict (rate_key, valid_from) do nothing;

comment on table public.premium_economic_rate_versions is
  'Tariffe economiche versionate. Ogni modifica crea una nuova versione e conserva lo storico.';
comment on table public.premium_economic_entries is
  'Registro economico aggiuntivo per ricavi, costi, stime e rettifiche. Non duplica premium_analysis_runs.';
comment on function public.premium_owner_economic_dashboard(integer) is
  'Cruscotto economico Owner-only; unisce costi IA Premium, tempo operatore, registro costi e movimenti economici.';

commit;
