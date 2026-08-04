-- OFFERTALOGICA PREMIUM v0.36.10
-- Abbonamenti Premium omaggio assegnabili esclusivamente dagli amministratori.
-- Il piano omaggio non usa Stripe, non ha rinnovo automatico e non applica
-- i limiti della prova gratuita. Alla scadenza segue i 90 giorni di archivio.

begin;

alter table public.premium_subscriptions
  add column if not exists complimentary_granted_at timestamptz,
  add column if not exists complimentary_granted_by uuid references public.premium_staff_members(user_id) on delete set null,
  add column if not exists complimentary_reason text not null default '',
  add column if not exists complimentary_revoked_at timestamptz;

comment on column public.premium_subscriptions.complimentary_granted_at is
  'Data dell’ultima concessione o proroga manuale del piano Premium omaggio.';
comment on column public.premium_subscriptions.complimentary_granted_by is
  'Amministratore che ha concesso o prorogato il piano Premium omaggio.';
comment on column public.premium_subscriptions.complimentary_reason is
  'Motivazione interna della concessione Premium omaggio.';
comment on column public.premium_subscriptions.complimentary_revoked_at is
  'Data dell’eventuale revoca manuale del piano Premium omaggio.';

create table if not exists public.premium_complimentary_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription_id uuid not null references public.premium_subscriptions(id) on delete cascade,
  action text not null check (action in ('grant', 'extend', 'revoke')),
  duration_code text not null check (duration_code in ('1_month', '3_months', '6_months', '12_months', 'unlimited', 'revoked')),
  period_start timestamptz not null,
  period_end timestamptz,
  reason text not null default '',
  staff_user_id uuid not null references public.premium_staff_members(user_id) on delete restrict,
  created_at timestamptz not null default now()
);

alter table public.premium_complimentary_events enable row level security;

create index if not exists premium_complimentary_events_user_idx
  on public.premium_complimentary_events (user_id, created_at desc);
create index if not exists premium_complimentary_events_subscription_idx
  on public.premium_complimentary_events (subscription_id, created_at desc);

revoke all on table public.premium_complimentary_events from public, anon, authenticated;
grant all on table public.premium_complimentary_events to service_role;

create or replace function public.premium_admin_set_complimentary(
  p_user_id uuid,
  p_duration_code text,
  p_reason text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid := auth.uid();
  v_subscription public.premium_subscriptions%rowtype;
  v_period_start timestamptz := now();
  v_period_end timestamptz;
  v_duration_code text := lower(trim(coalesce(p_duration_code, '')));
  v_reason text := left(trim(coalesce(p_reason, '')), 500);
  v_action text := 'grant';
  v_update_existing boolean := false;
begin
  if v_staff_id is null or not public.premium_is_staff(array['admin']) then
    raise exception 'premium_admin_required' using errcode = '42501';
  end if;

  if p_user_id is null then
    raise exception 'premium_complimentary_user_required' using errcode = '22023';
  end if;

  v_period_end := case v_duration_code
    when '1_month' then v_period_start + interval '1 month'
    when '3_months' then v_period_start + interval '3 months'
    when '6_months' then v_period_start + interval '6 months'
    when '12_months' then v_period_start + interval '12 months'
    when 'unlimited' then null
    else null
  end;

  if v_duration_code not in ('1_month', '3_months', '6_months', '12_months', 'unlimited') then
    raise exception 'premium_complimentary_duration_invalid' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.premium_profiles profile
    where profile.id = p_user_id
      and profile.account_status = 'active'
  ) then
    raise exception 'premium_complimentary_profile_not_active' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 10));

  select subscription.*
  into v_subscription
  from public.premium_subscriptions subscription
  where subscription.user_id = p_user_id
  order by subscription.created_at desc
  limit 1
  for update;

  if found
     and v_subscription.provider = 'stripe'
     and coalesce(v_subscription.provider_subscription_id, '') <> ''
     and v_subscription.status in ('trialing', 'active', 'past_due', 'paused') then
    raise exception 'premium_complimentary_paid_subscription_conflict' using errcode = 'P0001';
  end if;

  if found and v_subscription.plan_code = 'premium-complimentary' then
    v_action := 'extend';
    v_update_existing := true;
  elsif found
    and v_subscription.plan_code = 'premium-beta'
    and v_subscription.provider = 'offertalogica-beta' then
    -- La prova gratuita può essere trasformata nello stesso record. Gli storici
    -- Stripe terminati restano invece separati e non perdono gli identificativi.
    v_update_existing := true;
  end if;

  if v_update_existing then
    update public.premium_subscriptions subscription
    set
      status = 'active',
      plan_code = 'premium-complimentary',
      included_utilities = 2,
      included_bills_per_year = 1200,
      provider = 'offertalogica-complimentary',
      provider_customer_id = null,
      provider_subscription_id = null,
      current_period_start = v_period_start,
      current_period_end = v_period_end,
      archive_access_until = case when v_period_end is null then null else v_period_end + interval '90 days' end,
      cancel_at_period_end = (v_period_end is not null),
      data_purged_at = null,
      complimentary_granted_at = v_period_start,
      complimentary_granted_by = v_staff_id,
      complimentary_reason = v_reason,
      complimentary_revoked_at = null,
      updated_at = now()
    where subscription.id = v_subscription.id
    returning * into v_subscription;
  else
    insert into public.premium_subscriptions (
      user_id,
      status,
      plan_code,
      included_utilities,
      included_bills_per_year,
      provider,
      current_period_start,
      current_period_end,
      archive_access_until,
      cancel_at_period_end,
      complimentary_granted_at,
      complimentary_granted_by,
      complimentary_reason
    )
    values (
      p_user_id,
      'active',
      'premium-complimentary',
      2,
      1200,
      'offertalogica-complimentary',
      v_period_start,
      v_period_end,
      case when v_period_end is null then null else v_period_end + interval '90 days' end,
      (v_period_end is not null),
      v_period_start,
      v_staff_id,
      v_reason
    )
    returning * into v_subscription;
  end if;

  insert into public.premium_complimentary_events (
    user_id,
    subscription_id,
    action,
    duration_code,
    period_start,
    period_end,
    reason,
    staff_user_id
  )
  values (
    p_user_id,
    v_subscription.id,
    v_action,
    v_duration_code,
    v_period_start,
    v_period_end,
    v_reason,
    v_staff_id
  );

  return jsonb_build_object(
    'ok', true,
    'action', v_action,
    'subscription_id', v_subscription.id,
    'user_id', p_user_id,
    'status', v_subscription.status,
    'plan_code', v_subscription.plan_code,
    'current_period_start', v_subscription.current_period_start,
    'current_period_end', v_subscription.current_period_end,
    'archive_access_until', v_subscription.archive_access_until,
    'unlimited', v_subscription.current_period_end is null
  );
end;
$$;

revoke all on function public.premium_admin_set_complimentary(uuid, text, text) from public, anon;
grant execute on function public.premium_admin_set_complimentary(uuid, text, text) to authenticated, service_role;

create or replace function public.premium_admin_revoke_complimentary(
  p_user_id uuid,
  p_reason text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid := auth.uid();
  v_subscription public.premium_subscriptions%rowtype;
  v_revoke_at timestamptz := now();
  v_reason text := left(trim(coalesce(p_reason, '')), 500);
begin
  if v_staff_id is null or not public.premium_is_staff(array['admin']) then
    raise exception 'premium_admin_required' using errcode = '42501';
  end if;

  if p_user_id is null then
    raise exception 'premium_complimentary_user_required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 10));

  select subscription.*
  into v_subscription
  from public.premium_subscriptions subscription
  where subscription.user_id = p_user_id
    and subscription.plan_code = 'premium-complimentary'
    and subscription.status = 'active'
  order by subscription.created_at desc
  limit 1
  for update;

  if not found then
    raise exception 'premium_complimentary_active_subscription_not_found' using errcode = 'P0002';
  end if;

  update public.premium_subscriptions subscription
  set
    status = 'expired',
    current_period_end = v_revoke_at,
    archive_access_until = v_revoke_at + interval '90 days',
    cancel_at_period_end = true,
    complimentary_revoked_at = v_revoke_at,
    complimentary_reason = case when v_reason = '' then subscription.complimentary_reason else v_reason end,
    updated_at = now()
  where subscription.id = v_subscription.id
  returning * into v_subscription;

  insert into public.premium_complimentary_events (
    user_id,
    subscription_id,
    action,
    duration_code,
    period_start,
    period_end,
    reason,
    staff_user_id
  )
  values (
    p_user_id,
    v_subscription.id,
    'revoke',
    'revoked',
    coalesce(v_subscription.current_period_start, v_revoke_at),
    v_revoke_at,
    v_reason,
    v_staff_id
  );

  return jsonb_build_object(
    'ok', true,
    'action', 'revoke',
    'subscription_id', v_subscription.id,
    'user_id', p_user_id,
    'status', v_subscription.status,
    'plan_code', v_subscription.plan_code,
    'current_period_end', v_subscription.current_period_end,
    'archive_access_until', v_subscription.archive_access_until
  );
end;
$$;

revoke all on function public.premium_admin_revoke_complimentary(uuid, text) from public, anon;
grant execute on function public.premium_admin_revoke_complimentary(uuid, text) to authenticated, service_role;

-- Aggiorna sia la prova gratuita sia gli omaggi a durata limitata quando
-- l’utente apre l’app. Gli abbonamenti Stripe non vengono modificati.
create or replace function public.premium_refresh_trial_lifecycle()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_subscription public.premium_subscriptions%rowtype;
  v_phase text := 'none';
begin
  if v_user_id is null then
    raise exception 'premium_auth_required' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 2));

  update public.premium_subscriptions subscription
  set
    status = 'expired',
    archive_access_until = coalesce(
      subscription.archive_access_until,
      subscription.current_period_end + interval '90 days'
    ),
    updated_at = now()
  where subscription.user_id = v_user_id
    and subscription.current_period_end is not null
    and subscription.current_period_end <= now()
    and (
      (subscription.status = 'trialing' and subscription.plan_code = 'premium-beta')
      or
      (subscription.status = 'active' and subscription.plan_code = 'premium-complimentary')
    );

  select subscription.*
  into v_subscription
  from public.premium_subscriptions subscription
  where subscription.user_id = v_user_id
  order by subscription.created_at desc
  limit 1;

  if not found then
    return jsonb_build_object('ok', true, 'phase', 'none');
  end if;

  v_phase := case
    when v_subscription.data_purged_at is not null then 'purged'
    when v_subscription.status in ('trialing', 'active')
      and (v_subscription.current_period_end is null or v_subscription.current_period_end > now())
      then 'active'
    when v_subscription.archive_access_until is not null
      and v_subscription.archive_access_until > now()
      then 'archive'
    when v_subscription.archive_access_until is not null
      and v_subscription.archive_access_until <= now()
      then 'purge_due'
    else 'inactive'
  end;

  return jsonb_build_object(
    'ok', true,
    'subscription_id', v_subscription.id,
    'status', v_subscription.status,
    'plan_code', v_subscription.plan_code,
    'phase', v_phase,
    'current_period_start', v_subscription.current_period_start,
    'current_period_end', v_subscription.current_period_end,
    'archive_access_until', v_subscription.archive_access_until,
    'data_purged_at', v_subscription.data_purged_at
  );
end;
$$;

revoke all on function public.premium_refresh_trial_lifecycle() from public, anon;
grant execute on function public.premium_refresh_trial_lifecycle() to authenticated, service_role;

-- La stessa coda di cancellazione gestisce prove e omaggi scaduti.
create or replace function public.premium_trial_cleanup_candidates(p_limit integer default 100)
returns table (
  user_id uuid,
  subscription_id uuid,
  archive_access_until timestamptz,
  storage_paths text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    subscription.user_id,
    subscription.id,
    subscription.archive_access_until,
    coalesce(
      array_agg(object_record.name order by object_record.created_at)
        filter (where object_record.name is not null),
      array[]::text[]
    ) as storage_paths
  from public.premium_subscriptions subscription
  left join storage.objects object_record
    on object_record.bucket_id = 'premium-bills'
   and (storage.foldername(object_record.name))[1] = subscription.user_id::text
  where (
      (subscription.plan_code = 'premium-beta' and subscription.provider = 'offertalogica-beta')
      or
      (subscription.plan_code = 'premium-complimentary' and subscription.provider = 'offertalogica-complimentary')
    )
    and subscription.archive_access_until is not null
    and subscription.archive_access_until <= now()
    and subscription.data_purged_at is null
  group by subscription.user_id, subscription.id, subscription.archive_access_until
  order by subscription.archive_access_until asc
  limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

revoke all on function public.premium_trial_cleanup_candidates(integer) from public, anon, authenticated;
grant execute on function public.premium_trial_cleanup_candidates(integer) to service_role;

create or replace function public.premium_finalize_trial_data_purge(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subscription_id uuid;
  v_archive_end timestamptz;
  v_bill_ids uuid[] := array[]::uuid[];
  v_run_ids uuid[] := array[]::uuid[];
  v_check_ids uuid[] := array[]::uuid[];
  v_bills integer := 0;
  v_utilities integer := 0;
  v_contracts integer := 0;
begin
  if p_user_id is null then
    raise exception 'premium_cleanup_user_required' using errcode = '22023';
  end if;

  select subscription.id, subscription.archive_access_until
  into v_subscription_id, v_archive_end
  from public.premium_subscriptions subscription
  where subscription.user_id = p_user_id
    and (
      (subscription.plan_code = 'premium-beta' and subscription.provider = 'offertalogica-beta')
      or
      (subscription.plan_code = 'premium-complimentary' and subscription.provider = 'offertalogica-complimentary')
    )
    and subscription.data_purged_at is null
  order by subscription.created_at desc
  limit 1
  for update;

  if not found then
    raise exception 'premium_cleanup_subscription_not_found' using errcode = 'P0002';
  end if;

  if v_archive_end is null or v_archive_end > now() then
    raise exception 'premium_cleanup_not_due' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from storage.objects object_record
    where object_record.bucket_id = 'premium-bills'
      and (storage.foldername(object_record.name))[1] = p_user_id::text
  ) then
    raise exception 'premium_cleanup_storage_not_empty' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(bill.id), array[]::uuid[]), count(*)
  into v_bill_ids, v_bills
  from public.premium_bills bill
  where bill.user_id = p_user_id;

  select coalesce(array_agg(run.id), array[]::uuid[])
  into v_run_ids
  from public.premium_analysis_runs run
  where run.user_id = p_user_id;

  select coalesce(array_agg(check_record.id), array[]::uuid[])
  into v_check_ids
  from public.premium_checks check_record
  where check_record.user_id = p_user_id;

  select count(*) into v_contracts
  from public.premium_contracts contract_record
  where contract_record.user_id = p_user_id;

  select count(*) into v_utilities
  from public.premium_utilities utility
  where utility.user_id = p_user_id;

  delete from public.premium_cost_events cost
  where cost.user_id = p_user_id
     or cost.bill_id = any(v_bill_ids)
     or cost.analysis_run_id = any(v_run_ids)
     or cost.check_id = any(v_check_ids);

  delete from public.premium_communications communication
  where communication.user_id = p_user_id;

  delete from public.premium_bills bill
  where bill.user_id = p_user_id;

  delete from public.premium_contracts contract_record
  where contract_record.user_id = p_user_id;

  delete from public.premium_utilities utility
  where utility.user_id = p_user_id;

  update public.premium_subscriptions subscription
  set
    status = 'expired',
    data_purged_at = now(),
    updated_at = now()
  where subscription.id = v_subscription_id;

  return jsonb_build_object(
    'ok', true,
    'user_id', p_user_id,
    'subscription_id', v_subscription_id,
    'purged_at', now(),
    'deleted_bills', v_bills,
    'deleted_contracts', v_contracts,
    'deleted_utilities', v_utilities
  );
end;
$$;

revoke all on function public.premium_finalize_trial_data_purge(uuid) from public, anon, authenticated;
grant execute on function public.premium_finalize_trial_data_purge(uuid) to service_role;

commit;
