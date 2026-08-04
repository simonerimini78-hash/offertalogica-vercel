-- OFFERTALOGICA PREMIUM v0.36.15
-- Rende permanente il limite di quattro bollette complessivamente caricate
-- durante la prova gratuita. La cancellazione del documento non libera quota.
-- Gli upload effettuati durante un Premium omaggio che sospende una prova
-- vengono registrati e concorrono alla prova quando questa viene ripristinata.

begin;

create table if not exists public.premium_trial_bill_usage (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.premium_subscriptions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  bill_id uuid not null,
  status text not null default 'reserved'
    check (status in ('reserved', 'committed')),
  reserved_at timestamptz not null default now(),
  committed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bill_id),
  unique (subscription_id, bill_id)
);

create index if not exists premium_trial_bill_usage_subscription_idx
  on public.premium_trial_bill_usage (subscription_id, created_at);

create index if not exists premium_trial_bill_usage_user_idx
  on public.premium_trial_bill_usage (user_id, created_at);

alter table public.premium_trial_bill_usage enable row level security;

revoke all on table public.premium_trial_bill_usage from public, anon, authenticated;
grant select, insert, update, delete on table public.premium_trial_bill_usage to service_role;

comment on table public.premium_trial_bill_usage is
  'Registro permanente degli upload che consumano la quota della prova Premium; resta anche dopo la cancellazione della bolletta.';
comment on column public.premium_trial_bill_usage.status is
  'reserved durante il caricamento Storage; committed quando il PDF risulta presente nel bucket.';

-- Recupera le bollette ancora presenti per prove già attive o sospese da un
-- omaggio. Le bollette eliminate prima di questa migrazione non sono
-- ricostruibili con certezza e non vengono inventate.
with latest_subscription as (
  select distinct on (subscription.user_id)
    subscription.id,
    subscription.user_id,
    subscription.status,
    subscription.plan_code,
    subscription.current_period_start,
    subscription.created_at,
    subscription.complimentary_restore_trial,
    subscription.complimentary_trial_period_start
  from public.premium_subscriptions subscription
  order by subscription.user_id, subscription.created_at desc
), eligible_bills as (
  select
    subscription.id as subscription_id,
    bill.user_id,
    bill.id as bill_id,
    bill.created_at
  from latest_subscription subscription
  join public.premium_bills bill
    on bill.user_id = subscription.user_id
  where (
      (subscription.status = 'trialing' and subscription.plan_code = 'premium-beta')
      or
      (subscription.status = 'active'
        and subscription.plan_code = 'premium-complimentary'
        and subscription.complimentary_restore_trial = true)
    )
    and bill.created_at >= coalesce(
      subscription.complimentary_trial_period_start,
      subscription.current_period_start,
      subscription.created_at
    )
)
insert into public.premium_trial_bill_usage (
  subscription_id,
  user_id,
  bill_id,
  status,
  reserved_at,
  committed_at,
  created_at,
  updated_at
)
select
  eligible.subscription_id,
  eligible.user_id,
  eligible.bill_id,
  'committed',
  eligible.created_at,
  eligible.created_at,
  eligible.created_at,
  now()
from eligible_bills eligible
on conflict (bill_id) do nothing;

create or replace function public.premium_trial_bill_usage_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  with latest_subscription as (
    select subscription.id
    from public.premium_subscriptions subscription
    where subscription.user_id = (select auth.uid())
    order by subscription.created_at desc
    limit 1
  )
  select count(*)::integer
  from public.premium_trial_bill_usage usage
  where usage.user_id = (select auth.uid())
    and usage.subscription_id = (select id from latest_subscription);
$$;

revoke all on function public.premium_trial_bill_usage_count() from public, anon;
grant execute on function public.premium_trial_bill_usage_count() to authenticated, service_role;

create or replace function public.premium_reserve_trial_bill_upload(p_bill_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_subscription public.premium_subscriptions%rowtype;
  v_existing public.premium_trial_bill_usage%rowtype;
  v_usage_count integer := 0;
  v_limit integer := 0;
  v_tracks_trial boolean := false;
  v_enforces_trial_limit boolean := false;
begin
  if v_user_id is null then
    raise exception 'premium_auth_required' using errcode = '42501';
  end if;

  if p_bill_id is null then
    raise exception 'premium_bill_id_required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 15));

  select subscription.*
  into v_subscription
  from public.premium_subscriptions subscription
  where subscription.user_id = v_user_id
    and subscription.status in ('trialing', 'active')
    and (
      subscription.current_period_end is null
      or subscription.current_period_end > now()
    )
  order by subscription.created_at desc
  limit 1
  for update;

  if not found or not public.premium_has_service_access() then
    raise exception 'premium_service_access_required' using errcode = '42501';
  end if;

  v_enforces_trial_limit := v_subscription.status = 'trialing'
    and v_subscription.plan_code = 'premium-beta';

  v_tracks_trial := v_enforces_trial_limit
    or (
      v_subscription.status = 'active'
      and v_subscription.plan_code = 'premium-complimentary'
      and v_subscription.complimentary_restore_trial = true
    );

  if not v_tracks_trial then
    return jsonb_build_object(
      'ok', true,
      'tracked', false,
      'usage_count', null,
      'limit', null
    );
  end if;

  -- Libera prenotazioni interrotte prima della creazione del record bolletta.
  delete from public.premium_trial_bill_usage usage
  where usage.user_id = v_user_id
    and usage.subscription_id = v_subscription.id
    and usage.status = 'reserved'
    and usage.reserved_at < now() - interval '1 hour'
    and not exists (
      select 1
      from public.premium_bills bill
      where bill.id = usage.bill_id
        and bill.user_id = usage.user_id
    );

  select usage.*
  into v_existing
  from public.premium_trial_bill_usage usage
  where usage.bill_id = p_bill_id
  limit 1;

  if found then
    if v_existing.user_id <> v_user_id or v_existing.subscription_id <> v_subscription.id then
      raise exception 'premium_trial_bill_reservation_conflict' using errcode = '23505';
    end if;

    select count(*)::integer
    into v_usage_count
    from public.premium_trial_bill_usage usage
    where usage.subscription_id = v_subscription.id
      and usage.user_id = v_user_id;

    return jsonb_build_object(
      'ok', true,
      'tracked', true,
      'usage_count', v_usage_count,
      'limit', case when v_enforces_trial_limit then v_subscription.included_bills_per_year else null end,
      'already_reserved', true
    );
  end if;

  select count(*)::integer
  into v_usage_count
  from public.premium_trial_bill_usage usage
  where usage.subscription_id = v_subscription.id
    and usage.user_id = v_user_id;

  v_limit := greatest(1, coalesce(v_subscription.included_bills_per_year, 4));

  if v_enforces_trial_limit and v_usage_count >= v_limit then
    raise exception 'premium_trial_bill_limit_reached' using errcode = 'P0001';
  end if;

  insert into public.premium_trial_bill_usage (
    subscription_id,
    user_id,
    bill_id,
    status
  )
  values (
    v_subscription.id,
    v_user_id,
    p_bill_id,
    'reserved'
  );

  v_usage_count := v_usage_count + 1;

  return jsonb_build_object(
    'ok', true,
    'tracked', true,
    'usage_count', v_usage_count,
    'limit', case when v_enforces_trial_limit then v_limit else null end,
    'already_reserved', false
  );
end;
$$;

revoke all on function public.premium_reserve_trial_bill_upload(uuid) from public, anon;
grant execute on function public.premium_reserve_trial_bill_upload(uuid) to authenticated, service_role;

create or replace function public.premium_release_trial_bill_upload(p_bill_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_deleted boolean := false;
begin
  if v_user_id is null then
    raise exception 'premium_auth_required' using errcode = '42501';
  end if;

  if p_bill_id is null then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 15));

  delete from public.premium_trial_bill_usage usage
  where usage.user_id = v_user_id
    and usage.bill_id = p_bill_id
    and usage.status = 'reserved'
    and not exists (
      select 1
      from public.premium_bills bill
      where bill.id = usage.bill_id
        and bill.user_id = usage.user_id
    );

  v_deleted := found;
  return v_deleted;
end;
$$;

revoke all on function public.premium_release_trial_bill_upload(uuid) from public, anon;
grant execute on function public.premium_release_trial_bill_upload(uuid) to authenticated, service_role;

-- Se un record bolletta viene eliminato prima del completamento dello Storage,
-- la prenotazione non deve consumare la quota. Le righe committed restano invece
-- nello storico anche dopo la normale cancellazione della bolletta.
create or replace function public.premium_release_uncommitted_bill_usage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.premium_trial_bill_usage usage
  where usage.bill_id = old.id
    and usage.user_id = old.user_id
    and usage.status = 'reserved';
  return old;
end;
$$;

revoke all on function public.premium_release_uncommitted_bill_usage()
  from public, anon, authenticated;

drop trigger if exists premium_release_uncommitted_bill_usage_after_delete
  on public.premium_bills;
create trigger premium_release_uncommitted_bill_usage_after_delete
after delete on public.premium_bills
for each row execute function public.premium_release_uncommitted_bill_usage();

create or replace function public.premium_mark_bill_upload_complete(p_bill_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_bill public.premium_bills%rowtype;
begin
  if v_user_id is null then
    raise exception 'premium_auth_required' using errcode = '42501';
  end if;

  select bill.*
  into v_bill
  from public.premium_bills bill
  where bill.id = p_bill_id
    and bill.user_id = v_user_id
  limit 1
  for update;

  if not found then
    raise exception 'premium_bill_not_found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from storage.objects object
    where object.bucket_id = v_bill.storage_bucket
      and object.name = v_bill.storage_path
  ) then
    raise exception 'premium_bill_storage_missing' using errcode = 'P0002';
  end if;

  update public.premium_trial_bill_usage usage
  set
    status = 'committed',
    committed_at = coalesce(usage.committed_at, now()),
    updated_at = now()
  where usage.user_id = v_user_id
    and usage.bill_id = p_bill_id;

  update public.premium_bills bill
  set
    metadata = jsonb_set(
      jsonb_set(coalesce(bill.metadata, '{}'::jsonb), '{upload_complete}', 'true'::jsonb, true),
      '{upload_completed_at}',
      to_jsonb(now()),
      true
    ),
    updated_at = now()
  where bill.id = p_bill_id
    and bill.user_id = v_user_id;

  return true;
end;
$$;

revoke all on function public.premium_mark_bill_upload_complete(uuid) from public, anon;
grant execute on function public.premium_mark_bill_upload_complete(uuid) to authenticated, service_role;

-- La nuova variante verifica che il client abbia prenotato l'identificativo
-- della bolletta prima dell'INSERT. Per i piani non trial mantiene la quota
-- periodica già esistente.
create or replace function public.premium_can_add_bill(
  p_utility_id uuid,
  p_bill_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with active_subscription as (
    select
      subscription.id,
      subscription.status,
      subscription.plan_code,
      subscription.included_bills_per_year,
      subscription.complimentary_restore_trial,
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
  ),
  trial_usage as (
    select count(*)::integer as usage_count
    from public.premium_trial_bill_usage usage
    where usage.user_id = (select auth.uid())
      and usage.subscription_id = (select id from active_subscription)
  ),
  reservation as (
    select exists (
      select 1
      from public.premium_trial_bill_usage usage
      where usage.user_id = (select auth.uid())
        and usage.subscription_id = (select id from active_subscription)
        and usage.bill_id = p_bill_id
    ) as present
  )
  select
    (select public.premium_has_service_access())
    and exists (select 1 from active_subscription)
    and exists (select 1 from owned_utility)
    and case
      when (select status = 'trialing' and plan_code = 'premium-beta' from active_subscription)
        then coalesce((select present from reservation), false)
          and coalesce((select usage_count from trial_usage), 0)
            <= coalesce((select included_bills_per_year from active_subscription), 0)
      when (select status = 'active'
              and plan_code = 'premium-complimentary'
              and complimentary_restore_trial = true
            from active_subscription)
        then coalesce((select present from reservation), false)
      else coalesce((select user_bill_count from period_counts), 0)
        < coalesce((select included_bills_per_year from active_subscription), 0)
    end
    and coalesce((select utility_bill_count from period_counts), 0)
      < coalesce((select expected_bills_per_year from owned_utility), 0);
$$;

revoke all on function public.premium_can_add_bill(uuid, uuid) from public, anon;
grant execute on function public.premium_can_add_bill(uuid, uuid) to authenticated, service_role;

-- Sostituisce soltanto la policy INSERT delle bollette Premium.
drop policy if exists premium_bills_owner_insert on public.premium_bills;
create policy premium_bills_owner_insert
on public.premium_bills for insert to authenticated
with check (
  user_id = (select auth.uid())
  and (select public.premium_has_service_access())
  and (select public.premium_can_add_bill(utility_id, id))
  and storage_bucket = 'premium-bills'
  and split_part(storage_path, '/', 1) = (select auth.uid())::text
  and processing_status = 'uploaded'
  and customer_status = 'awaiting_review'
  and automatic_screening_status = 'pending'
  and automatic_screening_summary = ''
  and automatic_screening_reasons = '[]'::jsonb
  and automatic_screened_at is null
  and automatic_analysis_run_id is null
  and completed_at is null
  and deleted_at is null
);

commit;
