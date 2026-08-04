-- OFFERTALOGICA PREMIUM v0.36.7
-- Aggiorna la versione dei Termini Premium per includere la formula commerciale
-- approvata. Informativa privacy e consenso cloud/IA restano alla v0.36.6.

begin;

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
        and consent_record.version = 'premium-terms-v0.36.7-2026-08-04'
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

revoke all on function public.premium_has_current_acceptances() from public, anon;
grant execute on function public.premium_has_current_acceptances() to authenticated, service_role;

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
      ('terms'::text, 'premium-terms-v0.36.7-2026-08-04'::text),
      ('privacy'::text, 'premium-privacy-v0.36.6-2026-08-04'::text),
      ('cloud_storage'::text, 'premium-cloud-ai-v0.36.6-2026-08-04'::text)
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
     and coalesce(new.raw_user_meta_data ->> 'premium_terms_version', '') = 'premium-terms-v0.36.7-2026-08-04'
     and coalesce(new.raw_user_meta_data ->> 'premium_privacy_version', '') = 'premium-privacy-v0.36.6-2026-08-04'
     and coalesce(new.raw_user_meta_data ->> 'premium_cloud_version', '') = 'premium-cloud-ai-v0.36.6-2026-08-04' then
    insert into public.premium_consents (user_id, consent_type, version, granted, source, proof)
    values
      (new.id, 'terms', 'premium-terms-v0.36.7-2026-08-04', true, 'premium_signup', v_proof),
      (new.id, 'privacy', 'premium-privacy-v0.36.6-2026-08-04', true, 'premium_signup', v_proof),
      (new.id, 'cloud_storage', 'premium-cloud-ai-v0.36.6-2026-08-04', true, 'premium_signup', v_proof);
  end if;

  return new;
end;
$$;

revoke all on function public.premium_handle_new_user() from public, anon, authenticated;

comment on function public.premium_has_current_acceptances() is
  'Verifica i Termini commerciali v0.36.7 e le accettazioni privacy/cloud v0.36.6.';
comment on function public.premium_accept_current_terms(jsonb) is
  'Registra le accettazioni correnti, inclusi i Termini commerciali Premium v0.36.7.';

commit;
