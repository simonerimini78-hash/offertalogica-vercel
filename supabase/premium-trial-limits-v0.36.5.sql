-- OFFERTALOGICA PREMIUM v0.36.5
-- Prova gratuita: 30 giorni, 2 utenze della stessa abitazione,
-- 4 bollette complessive e una sola richiesta di controllo staff.
-- I limiti specifici si applicano esclusivamente al piano trialing premium-beta.

begin;

-- Allinea anche le prove beta già create dalla v0.36.4.
update public.premium_subscriptions
set
  included_utilities = 2,
  included_bills_per_year = 4,
  current_period_start = coalesce(current_period_start, created_at, now()),
  current_period_end = coalesce(current_period_start, created_at, now()) + interval '30 days',
  cancel_at_period_end = true,
  updated_at = now()
where status = 'trialing'
  and plan_code = 'premium-beta'
  and provider = 'offertalogica-beta';

create or replace function public.premium_activate_beta_trial()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_subscription public.premium_subscriptions%rowtype;
  v_period_start timestamptz := now();
  v_period_end timestamptz := now() + interval '30 days';
begin
  if v_user_id is null then
    raise exception 'premium_auth_required' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  if not exists (
    select 1
    from public.premium_profiles profile
    where profile.id = v_user_id
      and profile.account_status = 'active'
  ) then
    raise exception 'premium_active_profile_required' using errcode = '42501';
  end if;

  if not public.premium_has_current_acceptances() then
    raise exception 'premium_legal_acceptance_required' using errcode = '42501';
  end if;

  select subscription.*
  into v_subscription
  from public.premium_subscriptions subscription
  where subscription.user_id = v_user_id
  order by subscription.created_at desc
  limit 1;

  if found then
    return jsonb_build_object(
      'ok', true,
      'activated', false,
      'reason', 'subscription_exists',
      'subscription_id', v_subscription.id,
      'status', v_subscription.status,
      'plan_code', v_subscription.plan_code,
      'current_period_end', v_subscription.current_period_end
    );
  end if;

  insert into public.premium_subscriptions (
    user_id,
    status,
    plan_code,
    included_utilities,
    included_bills_per_year,
    provider,
    current_period_start,
    current_period_end,
    cancel_at_period_end
  )
  values (
    v_user_id,
    'trialing',
    'premium-beta',
    2,
    4,
    'offertalogica-beta',
    v_period_start,
    v_period_end,
    true
  )
  returning * into v_subscription;

  return jsonb_build_object(
    'ok', true,
    'activated', true,
    'subscription_id', v_subscription.id,
    'status', v_subscription.status,
    'plan_code', v_subscription.plan_code,
    'included_utilities', v_subscription.included_utilities,
    'included_bills_per_year', v_subscription.included_bills_per_year,
    'current_period_start', v_subscription.current_period_start,
    'current_period_end', v_subscription.current_period_end
  );
end;
$$;

revoke all on function public.premium_activate_beta_trial() from public, anon;
grant execute on function public.premium_activate_beta_trial() to authenticated, service_role;

-- La quota documenti usa il periodo della sottoscrizione corrente.
-- Per il trial premium-beta il limite è 4; per i piani active continua a usare
-- il limite configurato nella riga dell'abbonamento.
create or replace function public.premium_can_add_bill(p_utility_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with active_subscription as (
    select
      subscription.status,
      subscription.plan_code,
      subscription.included_bills_per_year,
      coalesce(subscription.current_period_start, subscription.created_at, now() - interval '1 year') as count_start
    from public.premium_subscriptions subscription
    where subscription.user_id = (select auth.uid())
      and subscription.status in ('trialing', 'active')
      and (
        subscription.current_period_end is null
        or subscription.current_period_end > now()
      )
    order by subscription.created_at desc
    limit 1
  ),
  owned_utility as (
    select utility.id, utility.expected_bills_per_year
    from public.premium_utilities utility
    where utility.id = p_utility_id
      and utility.user_id = (select auth.uid())
      and utility.status <> 'archived'
    limit 1
  ),
  period_counts as (
    select
      count(*) filter (where bill.user_id = (select auth.uid())) as user_bill_count,
      count(*) filter (where bill.utility_id = p_utility_id) as utility_bill_count
    from public.premium_bills bill
    where bill.user_id = (select auth.uid())
      and bill.deleted_at is null
      and bill.created_at >= coalesce((select count_start from active_subscription), now())
  )
  select
    (select public.premium_has_service_access())
    and exists (select 1 from active_subscription)
    and exists (select 1 from owned_utility)
    and coalesce((select user_bill_count from period_counts), 0)
      < coalesce((select included_bills_per_year from active_subscription), 0)
    and coalesce((select utility_bill_count from period_counts), 0)
      < coalesce((select expected_bills_per_year from owned_utility), 0);
$$;

revoke all on function public.premium_can_add_bill(uuid) from public, anon;
grant execute on function public.premium_can_add_bill(uuid) to authenticated, service_role;

-- Normalizzazione minima per confrontare l'indirizzo delle utenze durante la prova.
create or replace function public.premium_normalize_supply_address(p_address jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(
    lower(trim(coalesce(p_address ->> 'formatted', ''))),
    '[^[:alnum:]]+',
    '',
    'g'
  );
$$;

revoke all on function public.premium_normalize_supply_address(jsonb) from public, anon;
grant execute on function public.premium_normalize_supply_address(jsonb) to authenticated, service_role;

create or replace function public.premium_utility_allowed_for_plan(
  p_utility_id uuid,
  p_address jsonb
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with active_subscription as (
    select
      subscription.status,
      subscription.plan_code,
      subscription.included_utilities
    from public.premium_subscriptions subscription
    where subscription.user_id = (select auth.uid())
      and subscription.status in ('trialing', 'active')
      and (
        subscription.current_period_end is null
        or subscription.current_period_end > now()
      )
    order by subscription.created_at desc
    limit 1
  ),
  current_row as (
    select utility.id
    from public.premium_utilities utility
    where utility.id = p_utility_id
      and utility.user_id = (select auth.uid())
    limit 1
  ),
  other_utilities as (
    select utility.address
    from public.premium_utilities utility
    where utility.user_id = (select auth.uid())
      and utility.status <> 'archived'
      and utility.id <> p_utility_id
  )
  select
    (select public.premium_has_service_access())
    and exists (select 1 from active_subscription)
    and (select count(*) from other_utilities)
      < coalesce((select included_utilities from active_subscription), 0)
    and (
      not exists (
        select 1
        from active_subscription
        where status = 'trialing' and plan_code = 'premium-beta'
      )
      or (
        public.premium_normalize_supply_address(p_address) <> ''
        and not exists (
          select 1
          from other_utilities utility
          where public.premium_normalize_supply_address(utility.address) <> ''
            and public.premium_normalize_supply_address(utility.address)
              <> public.premium_normalize_supply_address(p_address)
        )
        and (
          exists (select 1 from current_row)
          or not exists (
            select 1
            from other_utilities utility
            where public.premium_normalize_supply_address(utility.address) = ''
          )
        )
      )
    );
$$;

revoke all on function public.premium_utility_allowed_for_plan(uuid, jsonb) from public, anon;
grant execute on function public.premium_utility_allowed_for_plan(uuid, jsonb) to authenticated, service_role;

-- Conserva la funzione storica per compatibilità, ma la policy usa il controllo
-- completo con indirizzo e identificativo della riga.
create or replace function public.premium_can_add_utility()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with active_subscription as (
    select subscription.included_utilities
    from public.premium_subscriptions subscription
    where subscription.user_id = (select auth.uid())
      and subscription.status in ('trialing', 'active')
      and (
        subscription.current_period_end is null
        or subscription.current_period_end > now()
      )
    order by subscription.created_at desc
    limit 1
  )
  select
    (select public.premium_has_service_access())
    and exists (select 1 from active_subscription)
    and (
      select count(*)
      from public.premium_utilities utility
      where utility.user_id = (select auth.uid())
        and utility.status <> 'archived'
    ) < coalesce((select included_utilities from active_subscription), 0);
$$;

revoke all on function public.premium_can_add_utility() from public, anon;
grant execute on function public.premium_can_add_utility() to authenticated, service_role;

drop policy if exists premium_utilities_owner_insert on public.premium_utilities;
create policy premium_utilities_owner_insert
on public.premium_utilities for insert to authenticated
with check (
  user_id = (select auth.uid())
  and (select public.premium_utility_allowed_for_plan(id, address))
);

drop policy if exists premium_utilities_owner_update on public.premium_utilities;
create policy premium_utilities_owner_update
on public.premium_utilities for update to authenticated
using (
  user_id = (select auth.uid())
  and (select public.premium_has_service_access())
)
with check (
  user_id = (select auth.uid())
  and (select public.premium_utility_allowed_for_plan(id, address))
);

-- Solo il trial premium-beta ha una quota di una richiesta staff.
-- I piani a pagamento active non ricevono questo limite.
create or replace function public.premium_request_check(p_bill_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_check_id uuid;
  v_processing_status text;
  v_customer_status text;
  v_screening_status text;
  v_subscription_status text;
  v_plan_code text;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_trial_check_count integer := 0;
begin
  if v_user_id is null then
    raise exception 'premium_auth_required' using errcode = '42501';
  end if;

  if not public.premium_has_service_access() then
    raise exception 'premium_service_access_required' using errcode = '42501';
  end if;

  if p_bill_id is null then
    raise exception 'premium_bill_not_found' using errcode = 'P0002';
  end if;

  -- Serializza anche richieste concorrenti su bollette diverse dello stesso trial.
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 1));
  perform pg_advisory_xact_lock(hashtextextended(p_bill_id::text, 0));

  select
    subscription.status,
    subscription.plan_code,
    coalesce(subscription.current_period_start, subscription.created_at),
    subscription.current_period_end
  into v_subscription_status, v_plan_code, v_period_start, v_period_end
  from public.premium_subscriptions subscription
  where subscription.user_id = v_user_id
    and subscription.status in ('trialing', 'active')
    and (subscription.current_period_end is null or subscription.current_period_end > now())
  order by subscription.created_at desc
  limit 1;

  if not found then
    raise exception 'premium_service_access_required' using errcode = '42501';
  end if;

  select bill.processing_status, bill.customer_status, bill.automatic_screening_status
  into v_processing_status, v_customer_status, v_screening_status
  from public.premium_bills bill
  where bill.id = p_bill_id
    and bill.user_id = v_user_id
    and bill.deleted_at is null
  for update;

  if not found then
    raise exception 'premium_bill_not_found' using errcode = 'P0002';
  end if;

  select check_record.id
  into v_check_id
  from public.premium_checks check_record
  where check_record.bill_id = p_bill_id
    and check_record.user_id = v_user_id
    and check_record.status <> 'canceled'
  order by check_record.created_at desc
  limit 1;

  if v_check_id is not null then
    return v_check_id;
  end if;

  if v_screening_status <> 'review_recommended'
     or v_processing_status <> 'completed'
     or v_customer_status <> 'anomaly_found' then
    raise exception 'premium_bill_not_requestable' using errcode = 'P0001';
  end if;

  if v_subscription_status = 'trialing' and v_plan_code = 'premium-beta' then
    select count(*)
    into v_trial_check_count
    from public.premium_checks check_record
    where check_record.user_id = v_user_id
      and check_record.created_at >= v_period_start
      and (v_period_end is null or check_record.created_at < v_period_end);

    if v_trial_check_count >= 1 then
      raise exception 'premium_trial_staff_limit_reached' using errcode = 'P0001';
    end if;
  end if;

  insert into public.premium_checks (
    bill_id,
    user_id,
    status,
    outcome,
    summary,
    customer_message
  )
  values (
    p_bill_id,
    v_user_id,
    'pending',
    'pending',
    '',
    ''
  )
  returning id into v_check_id;

  insert into public.premium_consents (
    user_id,
    consent_type,
    version,
    granted,
    source,
    proof
  )
  values (
    v_user_id,
    'remote_review',
    'premium-trial-limits-v0.36.5',
    true,
    'premium_app',
    jsonb_build_object(
      'bill_id', p_bill_id,
      'check_id', v_check_id,
      'automatic_screening_status', v_screening_status,
      'traffic_light', 'red',
      'subscription_status', v_subscription_status,
      'plan_code', v_plan_code
    )
  );

  update public.premium_bills
  set
    processing_status = 'queued',
    customer_status = 'awaiting_review',
    updated_at = now()
  where id = p_bill_id
    and user_id = v_user_id;

  return v_check_id;
end;
$$;

revoke all on function public.premium_request_check(uuid) from public, anon;
grant execute on function public.premium_request_check(uuid) to authenticated, service_role;

commit;
