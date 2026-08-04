-- OFFERTALOGICA PREMIUM v0.36.6
-- Ciclo di vita della prova: 30 giorni operativi, poi archivio in sola gestione
-- per 90 giorni. La cancellazione fisica dei PDF deve passare dalla Storage API;
-- questa migrazione prepara le scadenze, le policy e le funzioni di finalizzazione.

begin;

alter table public.premium_subscriptions
  add column if not exists archive_access_until timestamptz,
  add column if not exists data_purged_at timestamptz;

create index if not exists premium_subscriptions_archive_access_idx
  on public.premium_subscriptions (archive_access_until)
  where archive_access_until is not null and data_purged_at is null;

comment on column public.premium_subscriptions.archive_access_until is
  'Termine entro cui il cliente può consultare, scaricare o eliminare i dati dopo la fine del servizio.';
comment on column public.premium_subscriptions.data_purged_at is
  'Data di eliminazione dei dati operativi Premium; il profilo e la prova già utilizzata restano registrati.';

-- Allinea le prove beta già create. I 90 giorni decorrono dalla fine della prova.
update public.premium_subscriptions
set
  archive_access_until = current_period_end + interval '90 days',
  status = case
    when status = 'trialing' and current_period_end <= now() then 'expired'
    else status
  end,
  updated_at = now()
where plan_code = 'premium-beta'
  and provider = 'offertalogica-beta'
  and current_period_end is not null
  and (
    archive_access_until is distinct from current_period_end + interval '90 days'
    or (status = 'trialing' and current_period_end <= now())
  );

-- Versioni correnti dei documenti accettati durante la beta di lancio.
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
        and consent_record.version = 'premium-terms-v0.36.6-2026-08-04'
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
      ('terms'::text, 'premium-terms-v0.36.6-2026-08-04'::text),
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

-- Il trigger di registrazione accetta soltanto le versioni correnti inviate dall'app.
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
     and coalesce(new.raw_user_meta_data ->> 'premium_terms_version', '') = 'premium-terms-v0.36.6-2026-08-04'
     and coalesce(new.raw_user_meta_data ->> 'premium_privacy_version', '') = 'premium-privacy-v0.36.6-2026-08-04'
     and coalesce(new.raw_user_meta_data ->> 'premium_cloud_version', '') = 'premium-cloud-ai-v0.36.6-2026-08-04' then
    insert into public.premium_consents (user_id, consent_type, version, granted, source, proof)
    values
      (new.id, 'terms', 'premium-terms-v0.36.6-2026-08-04', true, 'premium_signup', v_proof),
      (new.id, 'privacy', 'premium-privacy-v0.36.6-2026-08-04', true, 'premium_signup', v_proof),
      (new.id, 'cloud_storage', 'premium-cloud-ai-v0.36.6-2026-08-04', true, 'premium_signup', v_proof);
  end if;

  return new;
end;
$$;

revoke all on function public.premium_handle_new_user() from public, anon, authenticated;

-- Le nuove prove ricevono fin dall'attivazione sia la scadenza operativa
-- sia il termine di conservazione dell'archivio.
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
  v_archive_end timestamptz := now() + interval '120 days';
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
      'current_period_end', v_subscription.current_period_end,
      'archive_access_until', v_subscription.archive_access_until,
      'data_purged_at', v_subscription.data_purged_at
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
    archive_access_until,
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
    v_archive_end,
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
    'current_period_end', v_subscription.current_period_end,
    'archive_access_until', v_subscription.archive_access_until
  );
end;
$$;

revoke all on function public.premium_activate_beta_trial() from public, anon;
grant execute on function public.premium_activate_beta_trial() to authenticated, service_role;

-- Aggiorna lo stato temporale della prova quando l'utente apre l'app.
-- La funzione non riattiva prove e non modifica gli abbonamenti pagati.
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
    and subscription.status = 'trialing'
    and subscription.plan_code = 'premium-beta'
    and subscription.current_period_end is not null
    and subscription.current_period_end <= now();

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

-- Accesso ai dati già salvati: servizio attivo oppure finestra archivio non scaduta.
create or replace function public.premium_has_archive_access()
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
        and profile.account_status in ('active', 'deletion_requested')
    )
    and exists (
      select 1
      from public.premium_subscriptions subscription
      where subscription.user_id = (select auth.uid())
        and subscription.data_purged_at is null
        and (
          (
            subscription.status in ('trialing', 'active')
            and (
              subscription.current_period_end is null
              or subscription.current_period_end > now()
            )
          )
          or (
            subscription.archive_access_until is not null
            and subscription.archive_access_until > now()
          )
        )
    );
$$;

revoke all on function public.premium_has_archive_access() from public, anon;
grant execute on function public.premium_has_archive_access() to authenticated, service_role;

-- Lettura e cancellazione restano disponibili durante i 90 giorni; inserimenti,
-- modifiche operative, analisi e richieste staff continuano a richiedere
-- premium_has_service_access().
drop policy if exists premium_utilities_owner_select on public.premium_utilities;
create policy premium_utilities_owner_select
on public.premium_utilities for select to authenticated
using (
  user_id = (select auth.uid())
  and (select public.premium_has_archive_access())
);

drop policy if exists premium_utilities_owner_delete on public.premium_utilities;
create policy premium_utilities_owner_delete
on public.premium_utilities for delete to authenticated
using (
  user_id = (select auth.uid())
  and (select public.premium_has_archive_access())
);

drop policy if exists premium_contracts_owner_select on public.premium_contracts;
create policy premium_contracts_owner_select
on public.premium_contracts for select to authenticated
using (
  user_id = (select auth.uid())
  and (select public.premium_has_archive_access())
);

drop policy if exists premium_bills_owner_select on public.premium_bills;
create policy premium_bills_owner_select
on public.premium_bills for select to authenticated
using (
  user_id = (select auth.uid())
  and (select public.premium_has_archive_access())
  and deleted_at is null
);

drop policy if exists premium_bills_owner_delete on public.premium_bills;
create policy premium_bills_owner_delete
on public.premium_bills for delete to authenticated
using (
  user_id = (select auth.uid())
  and (select public.premium_has_archive_access())
  and processing_status in ('uploaded', 'completed', 'failed')
  and automatic_screening_status <> 'running'
  and not exists (
    select 1
    from public.premium_checks check_record
    where check_record.bill_id = premium_bills.id
      and check_record.user_id = (select auth.uid())
      and check_record.status in ('pending', 'assigned', 'in_review', 'more_info_required')
  )
);

drop policy if exists premium_checks_owner_select on public.premium_checks;
create policy premium_checks_owner_select
on public.premium_checks for select to authenticated
using (
  user_id = (select auth.uid())
  and (select public.premium_has_archive_access())
);

drop policy if exists premium_anomalies_owner_select on public.premium_anomalies;
create policy premium_anomalies_owner_select
on public.premium_anomalies for select to authenticated
using (
  user_id = (select auth.uid())
  and (select public.premium_has_archive_access())
);

drop policy if exists premium_communications_owner_select on public.premium_communications;
create policy premium_communications_owner_select
on public.premium_communications for select to authenticated
using (
  user_id = (select auth.uid())
  and (select public.premium_has_archive_access())
);

drop policy if exists premium_communications_owner_update_read on public.premium_communications;
create policy premium_communications_owner_update_read
on public.premium_communications for update to authenticated
using (
  user_id = (select auth.uid())
  and (select public.premium_has_archive_access())
  and direction in ('staff_to_user', 'system_to_user')
)
with check (
  user_id = (select auth.uid())
  and (select public.premium_has_archive_access())
);

drop policy if exists premium_bills_storage_owner_select on storage.objects;
create policy premium_bills_storage_owner_select
on storage.objects for select to authenticated
using (
  bucket_id = 'premium-bills'
  and (select public.premium_has_archive_access())
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists premium_bills_storage_owner_delete on storage.objects;
create policy premium_bills_storage_owner_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'premium-bills'
  and (select public.premium_has_archive_access())
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.premium_bills bill
    where bill.storage_path = storage.objects.name
      and bill.user_id = (select auth.uid())
      and bill.processing_status in ('uploaded', 'completed', 'failed')
      and bill.automatic_screening_status <> 'running'
      and bill.deleted_at is null
      and not exists (
        select 1
        from public.premium_checks check_record
        where check_record.bill_id = bill.id
          and check_record.user_id = bill.user_id
          and check_record.status in ('pending', 'assigned', 'in_review', 'more_info_required')
      )
  )
);

-- Coda protetta per il futuro processo automatico basato su Storage API.
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
  where subscription.plan_code = 'premium-beta'
    and subscription.provider = 'offertalogica-beta'
    and subscription.archive_access_until is not null
    and subscription.archive_access_until <= now()
    and subscription.data_purged_at is null
  group by subscription.user_id, subscription.id, subscription.archive_access_until
  order by subscription.archive_access_until asc
  limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

revoke all on function public.premium_trial_cleanup_candidates(integer) from public, anon, authenticated;
grant execute on function public.premium_trial_cleanup_candidates(integer) to service_role;

-- Da chiamare soltanto dopo che il processo pianificato ha eliminato i PDF
-- tramite Storage API. Non elimina l'utente, il profilo, i consensi o il record
-- della prova già utilizzata.
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
    and subscription.plan_code = 'premium-beta'
    and subscription.provider = 'offertalogica-beta'
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
