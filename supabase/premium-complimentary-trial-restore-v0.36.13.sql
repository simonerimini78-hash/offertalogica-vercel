-- OFFERTALOGICA PREMIUM v0.36.13
-- Conserva la prova residua quando un amministratore concede Premium omaggio.
-- Alla revoca o alla scadenza dell'omaggio, la prova viene ripristinata soltanto
-- se era ancora attiva al momento della concessione. Le bollette caricate durante
-- l'omaggio restano archiviate e concorrono al limite di quattro della prova.

begin;

alter table public.premium_subscriptions
  add column if not exists complimentary_restore_trial boolean not null default false,
  add column if not exists complimentary_trial_period_start timestamptz,
  add column if not exists complimentary_trial_remaining_seconds bigint;

comment on column public.premium_subscriptions.complimentary_restore_trial is
  'Indica che alla fine dell’omaggio deve essere ripristinata la prova gratuita sospesa.';
comment on column public.premium_subscriptions.complimentary_trial_period_start is
  'Data iniziale della prova gratuita sospesa dall’attivazione dell’omaggio.';
comment on column public.premium_subscriptions.complimentary_trial_remaining_seconds is
  'Secondi di prova gratuiti residui al momento della concessione dell’omaggio.';

-- Recupera in modo prudente le prove convertite dalle versioni precedenti.
-- Un record creato prima della concessione e ancora entro i 30 giorni standard
-- viene considerato una prova beta preesistente.
update public.premium_subscriptions subscription
set
  complimentary_restore_trial = true,
  complimentary_trial_period_start = subscription.created_at,
  complimentary_trial_remaining_seconds = greatest(
    1,
    floor(extract(epoch from ((subscription.created_at + interval '30 days') - subscription.complimentary_granted_at)))::bigint
  )
where subscription.plan_code = 'premium-complimentary'
  and subscription.provider = 'offertalogica-complimentary'
  and subscription.complimentary_granted_at is not null
  and subscription.created_at < subscription.complimentary_granted_at
  and subscription.created_at + interval '30 days' > subscription.complimentary_granted_at
  and subscription.complimentary_restore_trial = false;

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
  v_restore_trial boolean := false;
  v_trial_period_start timestamptz;
  v_trial_remaining_seconds bigint;
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
    v_restore_trial := v_subscription.complimentary_restore_trial;
    v_trial_period_start := v_subscription.complimentary_trial_period_start;
    v_trial_remaining_seconds := v_subscription.complimentary_trial_remaining_seconds;
  elsif found
    and v_subscription.plan_code = 'premium-beta'
    and v_subscription.provider = 'offertalogica-beta' then
    v_update_existing := true;
    if v_subscription.status = 'trialing'
       and v_subscription.current_period_end is not null
       and v_subscription.current_period_end > v_period_start then
      v_restore_trial := true;
      v_trial_period_start := coalesce(v_subscription.current_period_start, v_subscription.created_at);
      v_trial_remaining_seconds := greatest(
        1,
        floor(extract(epoch from (v_subscription.current_period_end - v_period_start)))::bigint
      );
    end if;
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
      complimentary_restore_trial = v_restore_trial,
      complimentary_trial_period_start = v_trial_period_start,
      complimentary_trial_remaining_seconds = v_trial_remaining_seconds,
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
      complimentary_reason,
      complimentary_restore_trial,
      complimentary_trial_period_start,
      complimentary_trial_remaining_seconds
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
      v_reason,
      false,
      null,
      null
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
    'unlimited', v_subscription.current_period_end is null,
    'trial_will_restore', v_subscription.complimentary_restore_trial
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
  v_restore_trial boolean := false;
  v_trial_end timestamptz;
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

  v_restore_trial := v_subscription.complimentary_restore_trial
    and coalesce(v_subscription.complimentary_trial_remaining_seconds, 0) > 0;

  if v_restore_trial then
    v_trial_end := v_revoke_at + make_interval(
      secs => v_subscription.complimentary_trial_remaining_seconds::double precision
    );

    update public.premium_subscriptions subscription
    set
      status = 'trialing',
      plan_code = 'premium-beta',
      included_utilities = 2,
      included_bills_per_year = 4,
      provider = 'offertalogica-beta',
      provider_customer_id = null,
      provider_subscription_id = null,
      current_period_start = coalesce(subscription.complimentary_trial_period_start, subscription.created_at),
      current_period_end = v_trial_end,
      archive_access_until = v_trial_end + interval '90 days',
      cancel_at_period_end = true,
      data_purged_at = null,
      complimentary_revoked_at = v_revoke_at,
      complimentary_reason = case when v_reason = '' then subscription.complimentary_reason else v_reason end,
      complimentary_restore_trial = false,
      complimentary_trial_period_start = null,
      complimentary_trial_remaining_seconds = null,
      updated_at = now()
    where subscription.id = v_subscription.id
    returning * into v_subscription;
  else
    update public.premium_subscriptions subscription
    set
      status = 'expired',
      current_period_end = v_revoke_at,
      archive_access_until = v_revoke_at + interval '90 days',
      cancel_at_period_end = true,
      complimentary_revoked_at = v_revoke_at,
      complimentary_reason = case when v_reason = '' then subscription.complimentary_reason else v_reason end,
      complimentary_restore_trial = false,
      complimentary_trial_period_start = null,
      complimentary_trial_remaining_seconds = null,
      updated_at = now()
    where subscription.id = v_subscription.id
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
    'archive_access_until', v_subscription.archive_access_until,
    'restored_trial', v_restore_trial,
    'trial_ends_at', case when v_restore_trial then v_trial_end else null end
  );
end;
$$;

revoke all on function public.premium_admin_revoke_complimentary(uuid, text) from public, anon;
grant execute on function public.premium_admin_revoke_complimentary(uuid, text) to authenticated, service_role;

-- Quando un omaggio a durata limitata termina, ripristina automaticamente la
-- prova sospesa. Gli omaggi privi di prova precedente entrano invece in archivio.
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
    status = 'trialing',
    plan_code = 'premium-beta',
    included_utilities = 2,
    included_bills_per_year = 4,
    provider = 'offertalogica-beta',
    provider_customer_id = null,
    provider_subscription_id = null,
    current_period_start = coalesce(subscription.complimentary_trial_period_start, subscription.created_at),
    current_period_end = now() + make_interval(
      secs => subscription.complimentary_trial_remaining_seconds::double precision
    ),
    archive_access_until = now() + make_interval(
      secs => subscription.complimentary_trial_remaining_seconds::double precision
    ) + interval '90 days',
    cancel_at_period_end = true,
    data_purged_at = null,
    complimentary_revoked_at = coalesce(subscription.complimentary_revoked_at, subscription.current_period_end, now()),
    complimentary_restore_trial = false,
    complimentary_trial_period_start = null,
    complimentary_trial_remaining_seconds = null,
    updated_at = now()
  where subscription.user_id = v_user_id
    and subscription.status = 'active'
    and subscription.plan_code = 'premium-complimentary'
    and subscription.current_period_end is not null
    and subscription.current_period_end <= now()
    and subscription.complimentary_restore_trial = true
    and coalesce(subscription.complimentary_trial_remaining_seconds, 0) > 0;

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
      (subscription.status = 'active'
        and subscription.plan_code = 'premium-complimentary'
        and subscription.complimentary_restore_trial = false)
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

-- Ripristina anche gli omaggi già revocati con la versione precedente, quando
-- il record permette di dimostrare che la prova era ancora valida alla concessione.
update public.premium_subscriptions subscription
set
  status = 'trialing',
  plan_code = 'premium-beta',
  included_utilities = 2,
  included_bills_per_year = 4,
  provider = 'offertalogica-beta',
  provider_customer_id = null,
  provider_subscription_id = null,
  current_period_start = coalesce(subscription.complimentary_trial_period_start, subscription.created_at),
  current_period_end = now() + make_interval(
    secs => subscription.complimentary_trial_remaining_seconds::double precision
  ),
  archive_access_until = now() + make_interval(
    secs => subscription.complimentary_trial_remaining_seconds::double precision
  ) + interval '90 days',
  cancel_at_period_end = true,
  data_purged_at = null,
  complimentary_restore_trial = false,
  complimentary_trial_period_start = null,
  complimentary_trial_remaining_seconds = null,
  updated_at = now()
where subscription.plan_code = 'premium-complimentary'
  and subscription.provider = 'offertalogica-complimentary'
  and subscription.status = 'expired'
  and subscription.complimentary_revoked_at is not null
  and subscription.complimentary_restore_trial = true
  and coalesce(subscription.complimentary_trial_remaining_seconds, 0) > 0;

commit;
