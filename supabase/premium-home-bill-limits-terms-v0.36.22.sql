-- OFFERTALOGICA PREMIUM v0.36.22
-- Aggiorna i Termini Premium alla formula commerciale:
-- primo anno 3,99 EUR/mese equivalenti a 47,88 EUR/anno;
-- rinnovi 4,99 EUR/mese equivalenti a 59,88 EUR/anno.
-- Il piano Premium include 2 abitazioni, 60 bollette per periodo annuale e massimo 30 per abitazione.
-- Privacy e consenso cloud/IA restano invariati.

begin;

-- Il percorso REST diretto continua ad accettare esclusivamente le versioni
-- legali correnti e soltanto per l'utente autenticato.
drop policy if exists premium_consents_owner_insert on public.premium_consents;
create policy premium_consents_owner_insert
on public.premium_consents for insert to authenticated
with check (
  user_id = (select auth.uid())
  and (select public.premium_has_profile())
  and granted = true
  and revoked_at is null
  and source = 'premium_app'
  and (
    (consent_type = 'terms' and version = 'premium-terms-v0.36.22-2026-08-06')
    or (consent_type = 'privacy' and version = 'premium-privacy-v0.36.6-2026-08-04')
    or (consent_type = 'cloud_storage' and version = 'premium-cloud-ai-v0.36.6-2026-08-04')
  )
);

create or replace function public.premium_prepare_legal_consent()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_proof jsonb := coalesce(new.proof, '{}'::jsonb);
begin
  if auth.uid() is null then
    raise exception 'premium_auth_required' using errcode = '42501';
  end if;

  if jsonb_typeof(v_proof) <> 'object' then
    raise exception 'premium_invalid_consent_proof' using errcode = '22023';
  end if;

  if pg_column_size(v_proof) > 4096 then
    raise exception 'premium_consent_proof_too_large' using errcode = '22023';
  end if;

  new.user_id := auth.uid();
  new.granted := true;
  new.source := 'premium_app';
  new.recorded_at := now();
  new.revoked_at := null;
  new.proof := jsonb_strip_nulls(jsonb_build_object(
    'page', left(coalesce(v_proof ->> 'page', ''), 300),
    'user_agent', left(coalesce(v_proof ->> 'user_agent', ''), 500),
    'terms_version', 'premium-terms-v0.36.22-2026-08-06',
    'privacy_version', 'premium-privacy-v0.36.6-2026-08-04',
    'cloud_version', 'premium-cloud-ai-v0.36.6-2026-08-04',
    'server_recorded_at', now(),
    'server_recorded', true
  ));

  perform pg_advisory_xact_lock(
    hashtextextended(
      new.user_id::text || ':' || new.consent_type || ':' || new.version,
      0
    )
  );

  if exists (
    select 1
    from public.premium_consents existing
    where existing.user_id = new.user_id
      and existing.consent_type = new.consent_type
      and existing.version = new.version
      and existing.granted = true
      and existing.revoked_at is null
  ) then
    return null;
  end if;

  return new;
end;
$$;

revoke all on function public.premium_prepare_legal_consent()
  from public, anon, authenticated;

create or replace function public.premium_has_current_acceptances()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select
    exists (
      select 1 from public.premium_consents consent_record
      where consent_record.user_id = (select auth.uid())
        and consent_record.consent_type = 'terms'
        and consent_record.version = 'premium-terms-v0.36.22-2026-08-06'
        and consent_record.granted = true
        and consent_record.revoked_at is null
    )
    and exists (
      select 1 from public.premium_consents consent_record
      where consent_record.user_id = (select auth.uid())
        and consent_record.consent_type = 'privacy'
        and consent_record.version = 'premium-privacy-v0.36.6-2026-08-04'
        and consent_record.granted = true
        and consent_record.revoked_at is null
    )
    and exists (
      select 1 from public.premium_consents consent_record
      where consent_record.user_id = (select auth.uid())
        and consent_record.consent_type = 'cloud_storage'
        and consent_record.version = 'premium-cloud-ai-v0.36.6-2026-08-04'
        and consent_record.granted = true
        and consent_record.revoked_at is null
    );
$$;

revoke all on function public.premium_has_current_acceptances()
  from public, anon;
grant execute on function public.premium_has_current_acceptances()
  to authenticated, service_role;

create or replace function public.premium_accept_current_terms(
  p_proof jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_inserted integer := 0;
  v_proof jsonb := coalesce(p_proof, '{}'::jsonb);
begin
  if v_user_id is null then
    raise exception 'premium_auth_required' using errcode = '42501';
  end if;

  if jsonb_typeof(v_proof) <> 'object' then
    raise exception 'premium_invalid_consent_proof' using errcode = '22023';
  end if;

  if pg_column_size(v_proof) > 4096 then
    raise exception 'premium_consent_proof_too_large' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.premium_profiles profile
    where profile.id = v_user_id
      and profile.account_status = 'active'
  ) then
    raise exception 'premium_active_profile_required' using errcode = '42501';
  end if;

  insert into public.premium_consents (
    consent_type,
    version,
    granted,
    source,
    proof
  )
  values
    ('terms', 'premium-terms-v0.36.22-2026-08-06', true, 'premium_app', v_proof),
    ('privacy', 'premium-privacy-v0.36.6-2026-08-04', true, 'premium_app', v_proof),
    ('cloud_storage', 'premium-cloud-ai-v0.36.6-2026-08-04', true, 'premium_app', v_proof);

  get diagnostics v_inserted = row_count;

  return jsonb_build_object(
    'accepted', public.premium_has_current_acceptances(),
    'inserted_count', v_inserted,
    'recorded_at', now()
  );
end;
$$;

revoke all on function public.premium_accept_current_terms(jsonb)
  from public, anon;
grant execute on function public.premium_accept_current_terms(jsonb)
  to authenticated, service_role;

-- Le nuove registrazioni Premium accettano soltanto la versione corrente.
create or replace function public.premium_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_acceptance boolean := coalesce(new.raw_user_meta_data ->> 'premium_legal_acceptance', '') = 'accepted';
  v_proof jsonb := jsonb_build_object(
    'source', 'premium_signup',
    'server_recorded_at', now(),
    'signup_terms_version', coalesce(new.raw_user_meta_data ->> 'premium_terms_version', ''),
    'signup_privacy_version', coalesce(new.raw_user_meta_data ->> 'premium_privacy_version', ''),
    'signup_cloud_version', coalesce(new.raw_user_meta_data ->> 'premium_cloud_version', '')
  );
begin
  if coalesce(new.raw_user_meta_data ->> 'offertalogica_product', '') <> 'premium' then
    return new;
  end if;

  insert into public.premium_profiles (id, full_name, phone, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.phone, ''),
    lower(coalesce(new.email, ''))
  )
  on conflict (id) do update set
    email = excluded.email,
    updated_at = now();

  if v_acceptance
     and coalesce(new.raw_user_meta_data ->> 'premium_terms_version', '') = 'premium-terms-v0.36.22-2026-08-06'
     and coalesce(new.raw_user_meta_data ->> 'premium_privacy_version', '') = 'premium-privacy-v0.36.6-2026-08-04'
     and coalesce(new.raw_user_meta_data ->> 'premium_cloud_version', '') = 'premium-cloud-ai-v0.36.6-2026-08-04' then
    insert into public.premium_consents (user_id, consent_type, version, granted, source, proof)
    values
      (new.id, 'terms', 'premium-terms-v0.36.22-2026-08-06', true, 'premium_signup', v_proof),
      (new.id, 'privacy', 'premium-privacy-v0.36.6-2026-08-04', true, 'premium_signup', v_proof),
      (new.id, 'cloud_storage', 'premium-cloud-ai-v0.36.6-2026-08-04', true, 'premium_signup', v_proof);
  end if;

  return new;
end;
$$;

revoke all on function public.premium_handle_new_user()
  from public, anon, authenticated;

comment on function public.premium_has_current_acceptances() is
  'Verifica i Termini commerciali v0.36.22 e le accettazioni privacy/cloud correnti.';
comment on function public.premium_accept_current_terms(jsonb) is
  'Registra i Termini commerciali Premium v0.36.22 e le accettazioni privacy/cloud correnti.';


-- -----------------------------------------------------------------------------
-- Limiti Premium: prova invariata; Premium/omaggio 2 abitazioni e 60 bollette.
-- -----------------------------------------------------------------------------

create or replace function public.premium_apply_plan_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'trialing' and new.plan_code = 'premium-beta' then
    new.included_utilities := 2;
    new.included_bills_per_year := 4;
  elsif new.status = 'active' then
    new.included_utilities := 4;
    new.included_bills_per_year := 60;
  end if;
  return new;
end;
$$;

revoke all on function public.premium_apply_plan_limits() from public, anon, authenticated;

drop trigger if exists premium_apply_plan_limits_before_write on public.premium_subscriptions;
create trigger premium_apply_plan_limits_before_write
before insert or update of status, plan_code, included_utilities, included_bills_per_year
on public.premium_subscriptions
for each row execute function public.premium_apply_plan_limits();

update public.premium_subscriptions
set
  included_utilities = case when status = 'trialing' and plan_code = 'premium-beta' then 2 else 4 end,
  included_bills_per_year = case when status = 'trialing' and plan_code = 'premium-beta' then 4 else 60 end,
  updated_at = now()
where status in ('trialing','active');

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
    select subscription.status, subscription.plan_code, subscription.included_utilities
    from public.premium_subscriptions subscription
    where subscription.user_id = (select auth.uid())
      and subscription.status in ('trialing', 'active')
      and (subscription.current_period_end is null or subscription.current_period_end > now())
    order by subscription.created_at desc
    limit 1
  ),
  other_utilities as (
    select
      utility.id,
      case
        when public.premium_normalize_supply_address(utility.address) <> ''
          then public.premium_normalize_supply_address(utility.address)
        else 'utility:' || utility.id::text
      end as home_key
    from public.premium_utilities utility
    where utility.user_id = (select auth.uid())
      and utility.status <> 'archived'
      and utility.id <> p_utility_id
  ),
  proposed as (
    select public.premium_normalize_supply_address(p_address) as home_key
  ),
  home_keys as (
    select home_key from other_utilities
    union
    select home_key from proposed where home_key <> ''
  )
  select
    (select public.premium_has_service_access())
    and exists (select 1 from active_subscription)
    and (select count(*) from other_utilities)
      < coalesce((select included_utilities from active_subscription), 0)
    and (select home_key from proposed) <> ''
    and (
      (
        exists (select 1 from active_subscription where status = 'trialing' and plan_code = 'premium-beta')
        and (select count(*) from home_keys) <= 1
      )
      or
      (
        not exists (select 1 from active_subscription where status = 'trialing' and plan_code = 'premium-beta')
        and (select count(*) from home_keys) <= 2
      )
    );
$$;

revoke all on function public.premium_utility_allowed_for_plan(uuid, jsonb) from public, anon;
grant execute on function public.premium_utility_allowed_for_plan(uuid, jsonb) to authenticated, service_role;

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
      case
        when subscription.current_period_end is null and subscription.current_period_start is not null then
          subscription.current_period_start
          + make_interval(years => greatest(0, extract(year from age(now(), subscription.current_period_start))::integer))
        else coalesce(subscription.current_period_start, subscription.created_at, now())
      end as count_start
    from public.premium_subscriptions subscription
    where subscription.user_id = (select auth.uid())
      and subscription.status in ('trialing', 'active')
      and (subscription.current_period_end is null or subscription.current_period_end > now())
    order by subscription.created_at desc
    limit 1
  ),
  owned_utility as (
    select
      utility.id,
      case
        when public.premium_normalize_supply_address(utility.address) <> ''
          then public.premium_normalize_supply_address(utility.address)
        else 'utility:' || utility.id::text
      end as home_key
    from public.premium_utilities utility
    where utility.id = p_utility_id
      and utility.user_id = (select auth.uid())
      and utility.status <> 'archived'
    limit 1
  ),
  period_counts as (
    select
      count(*) as account_bill_count,
      count(*) filter (
        where case
          when public.premium_normalize_supply_address(utility.address) <> ''
            then public.premium_normalize_supply_address(utility.address)
          else 'utility:' || utility.id::text
        end = (select home_key from owned_utility)
      ) as home_bill_count
    from public.premium_bills bill
    join public.premium_utilities utility
      on utility.id = bill.utility_id and utility.user_id = bill.user_id
    where bill.user_id = (select auth.uid())
      and bill.created_at >= coalesce((select count_start from active_subscription), now())
  )
  select
    (select public.premium_has_service_access())
    and exists (select 1 from active_subscription)
    and exists (select 1 from owned_utility)
    and coalesce((select account_bill_count from period_counts), 0)
      < coalesce((select included_bills_per_year from active_subscription), 0)
    and (
      exists (select 1 from active_subscription where status = 'trialing' and plan_code = 'premium-beta')
      or coalesce((select home_bill_count from period_counts), 0) < 30
    );
$$;

revoke all on function public.premium_can_add_bill(uuid) from public, anon;
grant execute on function public.premium_can_add_bill(uuid) to authenticated, service_role;

comment on function public.premium_can_add_bill(uuid) is
  'Prova: 4 bollette complessive. Premium attivo/omaggio: 60 per periodo annuale e massimo 30 per abitazione.';
comment on function public.premium_utility_allowed_for_plan(uuid, jsonb) is
  'Prova: 2 forniture della stessa abitazione. Premium attivo/omaggio: massimo 4 forniture riferite a non più di 2 abitazioni.';

commit;
