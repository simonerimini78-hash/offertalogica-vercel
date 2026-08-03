-- OffertaLogica Premium v0.35
-- Recupero account, accettazioni legali versionate e richiesta di cancellazione.
-- Nessuna nuova funzione Vercel. Le risorse pubbliche gratuite restano invariate.

begin;

alter table public.premium_profiles
  add column if not exists deletion_requested_at timestamptz,
  add column if not exists deletion_request_reason text not null default '';

create index if not exists premium_profiles_deletion_requested_idx
  on public.premium_profiles (deletion_requested_at desc)
  where account_status = 'deletion_requested';

-- Il profilo resta leggibile e gestibile durante l'attesa della cancellazione.
-- Le nuove operazioni del servizio restano invece riservate agli account attivi.
create or replace function public.premium_has_profile()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.premium_profiles profile
    where profile.id = (select auth.uid())
      and profile.account_status in ('active', 'deletion_requested')
  );
$$;

revoke all on function public.premium_has_profile() from public, anon;
grant execute on function public.premium_has_profile() to authenticated, service_role;

create or replace function public.premium_has_current_acceptances()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1 from public.premium_consents consent_record
      where consent_record.user_id = (select auth.uid())
        and consent_record.consent_type = 'terms'
        and consent_record.version = 'premium-terms-v0.35-2026-08-03'
        and consent_record.granted = true
        and consent_record.revoked_at is null
    )
    and exists (
      select 1 from public.premium_consents consent_record
      where consent_record.user_id = (select auth.uid())
        and consent_record.consent_type = 'privacy'
        and consent_record.version = 'premium-privacy-v0.35-2026-08-03'
        and consent_record.granted = true
        and consent_record.revoked_at is null
    )
    and exists (
      select 1 from public.premium_consents consent_record
      where consent_record.user_id = (select auth.uid())
        and consent_record.consent_type = 'cloud_storage'
        and consent_record.version = 'premium-cloud-ai-v0.35-2026-08-03'
        and consent_record.granted = true
        and consent_record.revoked_at is null
    );
$$;

revoke all on function public.premium_has_current_acceptances() from public, anon;
grant execute on function public.premium_has_current_acceptances() to authenticated, service_role;

create or replace function public.premium_has_service_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1
      from public.premium_profiles profile
      where profile.id = (select auth.uid())
        and profile.account_status = 'active'
    )
    and (select public.premium_has_current_acceptances())
    and exists (
      select 1
      from public.premium_subscriptions subscription
      where subscription.user_id = (select auth.uid())
        and subscription.status in ('trialing', 'active')
        and (
          subscription.current_period_end is null
          or subscription.current_period_end > now()
        )
    );
$$;

revoke all on function public.premium_has_service_access() from public, anon;
grant execute on function public.premium_has_service_access() to authenticated, service_role;

-- Registra le tre prese d'atto obbligatorie usando versioni fissate lato database.
create or replace function public.premium_accept_current_terms(p_proof jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_inserted integer := 0;
  v_proof jsonb := coalesce(p_proof, '{}'::jsonb) || jsonb_build_object(
    'server_recorded_at', now(),
    'server_recorded', true
  );
begin
  if v_user_id is null then
    raise exception 'premium_auth_required' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.premium_profiles profile
    where profile.id = v_user_id
      and profile.account_status = 'active'
  ) then
    raise exception 'premium_active_profile_required' using errcode = '42501';
  end if;

  insert into public.premium_consents (user_id, consent_type, version, granted, source, proof)
  select v_user_id, acceptance.consent_type, acceptance.version, true, 'premium_app', v_proof
  from (
    values
      ('terms'::text, 'premium-terms-v0.35-2026-08-03'::text),
      ('privacy'::text, 'premium-privacy-v0.35-2026-08-03'::text),
      ('cloud_storage'::text, 'premium-cloud-ai-v0.35-2026-08-03'::text)
  ) as acceptance(consent_type, version)
  where not exists (
    select 1
    from public.premium_consents existing
    where existing.user_id = v_user_id
      and existing.consent_type = acceptance.consent_type
      and existing.version = acceptance.version
      and existing.granted = true
      and existing.revoked_at is null
  );

  get diagnostics v_inserted = row_count;

  return jsonb_build_object(
    'accepted', public.premium_has_current_acceptances(),
    'inserted_count', v_inserted,
    'recorded_at', now()
  );
end;
$$;

revoke all on function public.premium_accept_current_terms(jsonb) from public, anon;
grant execute on function public.premium_accept_current_terms(jsonb) to authenticated, service_role;

-- Il trigger conserva prova versionata anche quando la conferma email è richiesta.
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
     and coalesce(new.raw_user_meta_data ->> 'premium_terms_version', '') = 'premium-terms-v0.35-2026-08-03'
     and coalesce(new.raw_user_meta_data ->> 'premium_privacy_version', '') = 'premium-privacy-v0.35-2026-08-03'
     and coalesce(new.raw_user_meta_data ->> 'premium_cloud_version', '') = 'premium-cloud-ai-v0.35-2026-08-03' then
    insert into public.premium_consents (user_id, consent_type, version, granted, source, proof)
    values
      (new.id, 'terms', 'premium-terms-v0.35-2026-08-03', true, 'premium_signup', v_proof),
      (new.id, 'privacy', 'premium-privacy-v0.35-2026-08-03', true, 'premium_signup', v_proof),
      (new.id, 'cloud_storage', 'premium-cloud-ai-v0.35-2026-08-03', true, 'premium_signup', v_proof);
  end if;

  return new;
end;
$$;

revoke all on function public.premium_handle_new_user() from public, anon, authenticated;

create or replace function public.premium_request_account_deletion(p_reason text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_requested_at timestamptz := now();
begin
  if v_user_id is null then
    raise exception 'premium_auth_required' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.premium_staff_members staff
    where staff.user_id = v_user_id and staff.active = true
  ) then
    raise exception 'premium_staff_account_delete_blocked' using errcode = '42501';
  end if;

  update public.premium_profiles profile
  set
    account_status = 'deletion_requested',
    deletion_requested_at = coalesce(profile.deletion_requested_at, v_requested_at),
    deletion_request_reason = left(trim(coalesce(p_reason, '')), 500),
    updated_at = now()
  where profile.id = v_user_id
    and profile.account_status in ('active', 'deletion_requested');

  if not found then
    raise exception 'premium_profile_not_found' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'status', 'deletion_requested',
    'requested_at', v_requested_at
  );
end;
$$;

revoke all on function public.premium_request_account_deletion(text) from public, anon;
grant execute on function public.premium_request_account_deletion(text) to authenticated, service_role;

create or replace function public.premium_cancel_account_deletion_request()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'premium_auth_required' using errcode = '42501';
  end if;

  update public.premium_profiles profile
  set
    account_status = 'active',
    deletion_requested_at = null,
    deletion_request_reason = '',
    updated_at = now()
  where profile.id = v_user_id
    and profile.account_status = 'deletion_requested';

  if not found then
    raise exception 'premium_deletion_request_not_found' using errcode = 'P0002';
  end if;

  return jsonb_build_object('status', 'active', 'canceled_at', now());
end;
$$;

revoke all on function public.premium_cancel_account_deletion_request() from public, anon;
grant execute on function public.premium_cancel_account_deletion_request() to authenticated, service_role;

-- Il client admin rimuove prima i file dal bucket. La RPC elimina poi account Auth
-- e dati collegati; i costi vengono cancellati esplicitamente perché alcuni FK usano SET NULL.
create or replace function public.premium_staff_complete_account_deletion(
  p_user_id uuid,
  p_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id uuid := auth.uid();
  v_status text;
  v_bill_ids uuid[] := array[]::uuid[];
  v_run_ids uuid[] := array[]::uuid[];
  v_check_ids uuid[] := array[]::uuid[];
begin
  if v_admin_id is null or public.premium_staff_role() <> 'admin' then
    raise exception 'premium_admin_delete_required' using errcode = '42501';
  end if;

  if p_user_id is null or p_confirmation <> 'CANCELLA_ACCOUNT' then
    raise exception 'premium_account_delete_confirmation_required' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.premium_staff_members staff
    where staff.user_id = p_user_id and staff.active = true
  ) then
    raise exception 'premium_staff_account_delete_blocked' using errcode = '42501';
  end if;

  select profile.account_status into v_status
  from public.premium_profiles profile
  where profile.id = p_user_id
  for update;

  if not found then
    raise exception 'premium_profile_not_found' using errcode = 'P0002';
  end if;

  if v_status <> 'deletion_requested' then
    raise exception 'premium_account_deletion_not_requested' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from storage.objects object_record
    where object_record.bucket_id = 'premium-bills'
      and (storage.foldername(object_record.name))[1] = p_user_id::text
  ) then
    raise exception 'premium_account_storage_not_empty' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(bill.id), array[]::uuid[])
    into v_bill_ids
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

  delete from public.premium_cost_events cost
  where cost.user_id = p_user_id
     or cost.bill_id = any(v_bill_ids)
     or cost.analysis_run_id = any(v_run_ids)
     or cost.check_id = any(v_check_ids);

  delete from auth.users auth_user
  where auth_user.id = p_user_id;

  if not found then
    raise exception 'premium_auth_user_not_found' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'deleted_user_id', p_user_id,
    'deleted_at', now(),
    'deleted_by', v_admin_id
  );
end;
$$;

revoke all on function public.premium_staff_complete_account_deletion(uuid, text) from public, anon;
grant execute on function public.premium_staff_complete_account_deletion(uuid, text) to authenticated, service_role;

comment on function public.premium_accept_current_terms(jsonb) is
  'Registra prese d’atto versionate per termini, informativa e trattamento cloud/IA necessario al servizio Premium.';
comment on function public.premium_request_account_deletion(text) is
  'Registra la richiesta del cliente senza rimuovere immediatamente dati o credenziali.';
comment on function public.premium_staff_complete_account_deletion(uuid, text) is
  'Elimina account Auth e dati Premium dopo richiesta del cliente e rimozione dei file Storage.';

commit;
